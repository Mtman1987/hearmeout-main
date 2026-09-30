'use strict';

const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { existsSync, mkdirSync, readFileSync, createReadStream, statSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const run = promisify(execFile);

function inspectSpotlightPlaylist(playlist, ageMs) {
  const segmentCount = (playlist.match(/^seg_\d+\.ts$/gm) || []).length;
  const duration = Math.max(0, ...(playlist.match(/^#EXTINF:([\d.]+)/gm) || [])
    .map(line => Number(line.slice(8)) || 0));
  return { segmentCount, stalled: segmentCount >= 2 && (ageMs > 15000 || duration > 15) };
}

function shouldRecycleSpotlight() {
  // A stalled Twitch playlist can simply be a preroll/ad discontinuity.
  // Never recycle an otherwise-live upstream Spotlight session because doing so
  // creates a brand-new Twitch session and therefore another preroll.
  return false;
}

function createSpotlightHls({ spotlightEndpoint, root = '/tmp/spotlight-hls' }) {
  let login = '', generation = '', encoder = null, failure = '', inflight = null, timer = null, lastPoll = 0;
  let recoveries = 0, startedAt = 0, failedLogin = '', failedLoginUntil = 0;

  function stop() {
    if (encoder && encoder.exitCode === null) encoder.kill('SIGTERM');
    encoder = null;
  }

  async function resolve(loginName) {
    const { stdout } = await run('yt-dlp', [
      '--no-warnings', '--no-playlist', '-g', '-f', 'best[height<=480]/best',
      `https://www.twitch.tv/${loginName}`,
    ], { timeout: 60000, maxBuffer: 256 * 1024 });
    const url = String(stdout).trim().split(/\r?\n/)[0];
    if (!/^https:\/\//.test(url)) throw Error('Twitch did not return a playable stream');
    return url;
  }

  function manifest() {
    const path = join(root, generation, 'index.m3u8');
    return generation && existsSync(path) ? readFileSync(path, 'utf8') : '';
  }

  function status() {
    const playlist = manifest();
    const path = join(root, generation, 'index.m3u8');
    const ageMs = generation && existsSync(path) ? Date.now() - statSync(path).mtimeMs : Date.now() - startedAt;
    // A live process and eight old segments do not prove that video is moving.
    const { segmentCount: segments, stalled } = inspectSpotlightPlaylist(playlist, ageMs);
    const active = Boolean(encoder && encoder.exitCode === null && !encoder.killed);
    return { configured: true, active, activated: Boolean(login), currentLogin: login,
      generation, ready: active && segments >= 2 && !stalled, segmentCount: segments,
      stalled, playlistAgeMs: Math.max(0, Math.round(ageMs)), recoveryCount: recoveries,
      error: stalled ? 'Spotlight video stopped advancing' : failure || null };
  }

  async function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      lastPoll = Date.now();
      const response = await fetch(spotlightEndpoint, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(`Spotlight directory returned ${response.status}`);
      const data = await response.json();
      const selected = String(data?.spotlight?.twitchLogin || data?.spotlight?.user?.twitchLogin || '').replace(/^@/, '').toLowerCase();
      if (!selected || !/^[a-z0-9_]{1,25}$/.test(selected)) {
        if (login) { stop(); login = ''; generation = ''; }
        failure = 'No live community Spotlight is available';
        return status();
      }
      const current = status();
      if (selected === login && encoder && encoder.exitCode === null && !encoder.killed) {
        // Keep the exact same Twitch source session through prerolls and other
        // temporary playlist stalls. Re-resolving the channel would create a
        // new Twitch session and can trigger another preroll indefinitely.
        return current;
      }
      if (selected === failedLogin && Date.now() < failedLoginUntil) {
        stop(); login = ''; generation = '';
        failure = 'Selected Spotlight source is offline; waiting for the live rotation to change';
        return status();
      }
      let source;
      try {
        source = await resolve(selected);
        failedLogin = ''; failedLoginUntil = 0;
      } catch {
        stop(); login = ''; generation = '';
        failedLogin = selected; failedLoginUntil = Date.now() + 60_000;
        failure = 'Selected Spotlight source is offline; waiting for the live rotation to change';
        return status();
      }
      stop();
      const previous = generation;
      login = selected;
      generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      startedAt = Date.now();
      const folder = join(root, generation);
      mkdirSync(folder, { recursive: true });
      const child = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-rw_timeout', '15000000', '-i', source,
        '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'copy',
        '-f', 'hls', '-hls_time', '4', '-hls_list_size', '8',
        '-hls_flags', 'delete_segments+independent_segments+temp_file',
        '-hls_delete_threshold', '3',
        '-hls_segment_filename', join(folder, 'seg_%06d.ts'), join(folder, 'index.m3u8'),
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      encoder = child;
      failure = '';
      child.stderr.resume(); // Never log signed Twitch playlist URLs.
      child.once('error', () => { if (encoder === child) failure = 'Spotlight encoder could not start'; });
      child.once('close', () => { if (encoder === child) { failure = 'Spotlight stream disconnected'; recoveries++; } });
      if (previous) setTimeout(() => rmSync(join(root, previous), { recursive: true, force: true }), 10000).unref();
      return status();
    })().catch(error => {
      failure = /Spotlight directory/.test(error.message) ? error.message : 'Spotlight stream is reconnecting';
      throw error;
    }).finally(() => { inflight = null; });
    return inflight;
  }

  async function start() {
    if (!timer) timer = setInterval(() => {
      if (Date.now() - lastPoll >= 9000) refresh().catch(() => {});
    }, 10000);
    return refresh();
  }

  async function file(version, name, response) {
    if (version !== generation || !/^(?:index\.m3u8|seg_\d{6}\.ts)$/.test(name)) return response.status(404).end();
    const path = join(root, generation, name);
    if (!existsSync(path) || !statSync(path).isFile()) return response.status(404).end();
    response.setHeader('Cache-Control', name === 'index.m3u8' ? 'no-store' : 'public, max-age=30');
    response.setHeader('Content-Type', name === 'index.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    return name === 'index.m3u8' ? response.send(readFileSync(path, 'utf8')) : createReadStream(path).pipe(response);
  }

  return { start, status, file, consent: async () => ({ ...status(), warningCleared: false }) };
}

module.exports = { createSpotlightHls, inspectSpotlightPlaylist, shouldRecycleSpotlight };
