'use strict';

const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { existsSync, mkdirSync, readFileSync, createReadStream, statSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const run = promisify(execFile);

// Repair packet clocks at Twitch stitched-ad boundaries while retaining stream
// copy and valid B-frame offsets. Twitch can jump both DTS and PTS-DTS by hours.
function spotlightTimestampFilter(audio = false) {
  const step = audio ? '1024/(SR*TB)' : '1/(30*TB)';
  const duration = `if(between(DURATION,1,1/TB),DURATION,${step})`;
  const dts = `if(eq(N,0),0,PREV_OUTDTS+if(between(DTS-PREV_INDTS,1,1/TB),DTS-PREV_INDTS,${duration}))`;
  return `setts=dts='${dts}':pts='${dts}+if(between(PTS-DTS,-1/TB,1/TB),PTS-DTS,0)':duration='${duration}'`;
}

function inspectSpotlightCommercial(playlist, now = Date.now()) {
  let found = null;
  for (const line of String(playlist).split(/\r?\n/)) {
    if (!line.startsWith('#EXT-X-DATERANGE:')) continue;
    const attrs = Object.fromEntries([...line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)]
      .map(match => [match[1], match[2] ?? match[3]]));
    if (attrs.CLASS !== 'twitch-stitched-ad') continue;
    const start = Date.parse(attrs['START-DATE']);
    const end = Date.parse(attrs['END-DATE']);
    const seconds = Number(attrs.DURATION || attrs['PLANNED-DURATION']);
    if (!Number.isFinite(start) || start > now || !attrs.ID) continue;
    const until = Number.isFinite(end) ? end : start + seconds * 1000;
    // Match the relay's buffered playback instead of dropping the cover while
    // its last ad segments are still playing. Ignore old playlist markers.
    const activeUntil = until + 12000;
    if (!Number.isFinite(activeUntil) || until <= start || activeUntil <= now) continue;
    if (!found || activeUntil > found.activeUntil) found = {
      id: attrs.ID, breakStartedAt: start, activeUntil,
    };
  }
  return found;
}

function inspectSpotlightPlaylist(playlist, ageMs) {
  const segmentCount = (playlist.match(/^seg_\d+\.ts$/gm) || []).length;
  const duration = Math.max(0, ...(playlist.match(/^#EXTINF:([\d.]+)/gm) || [])
    .map(line => Number(line.slice(8)) || 0));
  // Stream-copy HLS cuts at source keyframes, so a healthy chunk can exceed 15s.
  // Allow two chunk intervals for progress, but still reject timestamp jumps.
  return { segmentCount, stalled: ageMs > Math.max(15000, duration * 2000) || (segmentCount >= 2 && duration > 60) };
}

function shouldRecycleSpotlight(state) {
  // Preserve one Twitch session through short ads; recover a genuinely stuck
  // encoder or invalid timeline after two minutes rather than waiting forever.
  return Boolean(state?.stalled && Math.max(state.playlistAgeMs || 0, state.stalledForMs || 0) >= 120000);
}

function createSpotlightHls({ spotlightEndpoint, root = '/tmp/spotlight-hls' }) {
  let login = '', generation = '', encoder = null, failure = '', inflight = null, timer = null, lastPoll = 0;
  let recoveries = 0, startedAt = 0, failedLogin = '', failedLoginUntil = 0, stalledSince = null;
  let sourceUrl = '', commercialBreak = null, pendingSource = null;

  function stop() {
    if (encoder && encoder.exitCode === null) encoder.kill('SIGTERM');
    encoder = null;
    sourceUrl = ''; commercialBreak = null;
  }

  async function inspectSourceCommercial() {
    if (!sourceUrl) return;
    const source = sourceUrl;
    try {
      const response = await fetch(source, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return;
      const marker = inspectSpotlightCommercial(await response.text());
      if (source !== sourceUrl) return;
      if (marker) commercialBreak = marker;
      else if (commercialBreak?.activeUntil <= Date.now()) commercialBreak = null;
    } catch { /* Retain the last confirmed marker only until its expiry. */ }
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
    const { segmentCount: segments, stalled: playlistStalled } = inspectSpotlightPlaylist(playlist, ageMs);
    const active = Boolean(encoder && encoder.exitCode === null && !encoder.killed);
    const stalled = active && Boolean(generation) && playlistStalled;
    return { configured: true, active, activated: Boolean(login), currentLogin: login,
      generation, ready: active && segments >= 2 && !stalled, segmentCount: segments,
      stalled, playlistAgeMs: Math.max(0, Math.round(ageMs)), recoveryCount: recoveries,
      commercialBreak: commercialBreak && commercialBreak.activeUntil > Date.now()
        ? { ...commercialBreak, active: true } : null,
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
        if (login) { stop(); login = ''; generation = ''; stalledSince = null; }
        pendingSource = null;
        failure = 'No live community Spotlight is available';
        return status();
      }
      const current = status();
      if (current.active && current.stalled) { if (stalledSince === null) stalledSince = Date.now(); }
      else stalledSince = null;
      const recycle = current.active && shouldRecycleSpotlight({ ...current, stalledForMs: stalledSince === null ? 0 : Date.now() - stalledSince });
      if (selected === login && encoder && encoder.exitCode === null && !encoder.killed && !recycle) {
        // Keep the exact same Twitch source session through prerolls and other
        // temporary playlist stalls. Only a prolonged stall permits re-resolving.
        await inspectSourceCommercial();
        // Twitch may attach a preroll only after our preflight request. An
        // encoder opened before that marker can stay stuck with zero output
        // even after the source advances. Close that empty demuxer, retaining
        // the same signed session, and let the existing preroll wait reopen it.
        if (current.segmentCount === 0 && current.stalled && commercialBreak) {
          const marker = commercialBreak;
          pendingSource = { login: selected, url: sourceUrl };
          stop();
          generation = '';
          commercialBreak = marker;
          stalledSince = null;
          failure = 'Waiting for the current Twitch preroll to finish';
        }
        return status();
      }
      if (selected === failedLogin && Date.now() < failedLoginUntil) {
        stop(); login = ''; generation = '';
        failure = 'Selected Spotlight source is offline; waiting for the live rotation to change';
        return status();
      }
      let source;
      try {
        // Reopening the same usable session avoids a new preroll on every recovery.
        source = selected === login && sourceUrl ? sourceUrl
          : pendingSource?.login === selected ? pendingSource.url : await resolve(selected);
        failedLogin = ''; failedLoginUntil = 0;
      } catch {
        stop(); login = ''; generation = '';
        failedLogin = selected; failedLoginUntil = Date.now() + 60_000;
        failure = 'Selected Spotlight source is offline; waiting for the live rotation to change';
        return status();
      }
      // Opening FFmpeg during a stitched preroll can leave its demuxer stuck
      // even after the playlist becomes live. Keep one session pending until
      // that preroll expires instead of repeatedly resolving a fresh ad.
      const sourceResponse = await fetch(source, { signal: AbortSignal.timeout(8000) });
      if (!sourceResponse.ok) {
        if (sourceResponse.status === 401 || sourceResponse.status === 403) {
          pendingSource = null;
          if (source === sourceUrl) sourceUrl = '';
        }
        throw Error('Spotlight source playlist unavailable');
      }
      const preroll = inspectSpotlightCommercial(await sourceResponse.text());
      if (preroll) {
        pendingSource = { login: selected, url: source };
        if (!current.active) {
          login = selected;
          commercialBreak = preroll;
          failure = 'Waiting for the current Twitch preroll to finish';
        }
        return status();
      }
      pendingSource = null;
      if (recycle) recoveries++;
      stop();
      sourceUrl = source;
      stalledSince = null;
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
        '-bsf:v', spotlightTimestampFilter(), '-bsf:a', spotlightTimestampFilter(true),
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
      await inspectSourceCommercial();
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

module.exports = { createSpotlightHls, inspectSpotlightPlaylist, shouldRecycleSpotlight,
  spotlightTimestampFilter, inspectSpotlightCommercial };
