const { spawn, execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const { mkdirSync, existsSync, readFileSync, statSync, createReadStream, rmSync } = require('node:fs');
const { join } = require('node:path');
const probe = promisify(execFile);

function safeHlsToken(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function streamKeyForGeneration(requestId, generation) {
  return safeHlsToken(requestId) + '-' + safeHlsToken(generation);
}

function rewriteManifestForGeneration(manifest, requestId, generation) {
  const prefix = streamKeyForGeneration(requestId, generation) + '-';
  return String(manifest || '').split(/\r?\n/).map(line =>
    /^segment_\d{6}\.ts$/.test(line) ? prefix + line : line
  ).join('\n');
}

function internalSegmentName(name, requestId, generation) {
  const prefix = streamKeyForGeneration(requestId, generation) + '-';
  if (!String(name || '').startsWith(prefix)) return null;
  const segment = String(name).slice(prefix.length);
  return /^segment_\d{6}\.ts$/.test(segment) ? segment : null;
}

function createDirectLounge({ program, sourceForMovie, root, onMovieEnded }) {
  let current = null;
  let process = null;
  let error = '';
  let checking = null;
  let lastChecked = 0;
  let lastFailed = 0;
  let lastObservedStreamKey = '';
  let lastObservedSegment = -1;
  let lastSegmentAdvanceAt = 0;
  let lastTelemetryAt = 0;
  const folder = join(root, 'lounge-direct');
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });

  async function selectedMovie() {
    const movie = program().movie;
    if (!movie?.current || movie.playback?.status !== 'playing') return null;
    const match = String(movie.current.item?.playbackUrl || '').match(/^\/api\/watch\/xtream\/hls\/(vod|series)-(\d+)\/index\.m3u8$/);
    if (!match) return null;
    return {
      requestId: movie.current.requestId,
      title: movie.current.item.title,
      requester: movie.current.requestedBy?.username || '',
      kind: match[1],
      id: match[2],
      playbackPosition: Math.max(0, Number(movie.playback?.position || 0)),
      seekRevision: Number(movie.playback?.seekRevision || 0),
      selection: movie,
    };
  }

  async function stopActiveProcess() {
    const previous = process;
    process = null;
    if (!previous || previous.exitCode !== null) return;
    await new Promise((resolve) => {
      let settled = false;
      let forceTimer;
      let finishTimer;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        clearTimeout(finishTimer);
        resolve();
      };
      previous.once('close', finish);
      try { previous.kill('SIGTERM'); } catch { finish(); return; }
      forceTimer = setTimeout(() => {
        if (previous.exitCode === null) {
          try { previous.kill('SIGKILL'); } catch {}
        }
        finishTimer = setTimeout(finish, 250);
      }, 1000);
    });
  }

  async function start(movie) {
    await stopActiveProcess();
    error = '';
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    const dir = join(folder, movie.requestId.replace(/[^a-zA-Z0-9_-]/g, ''));
    mkdirSync(dir, { recursive: true });
    const source = { url: sourceForMovie(movie.selection) };
    const startPosition = Math.max(0, Number(movie.playbackPosition || 0));
    movie.captureStartedAt = Date.now();
    movie.captureStartPosition = startPosition;
    movie.generation = randomUUID().replace(/-/g, '');
    lastObservedStreamKey = streamKeyForGeneration(movie.requestId, movie.generation);
    lastObservedSegment = -1;
    lastSegmentAdvanceAt = Date.now();
    console.log(`[LoungeHLS] generation-start request=${safeHlsToken(movie.requestId)} generation=${movie.generation} position=${startPosition.toFixed(1)}`);

    let audioIndex = '0:a:0?';
    let audioCodec = '';
    let videoCodec = 'h264';
    try {
      const result = await probe('ffprobe', ['-v', 'error', '-user_agent', 'DiscordStreamHub/1.0', '-show_entries', 'stream=index,codec_name,codec_type:stream_tags=language,title', '-of', 'json', source.url], { timeout: 15000, maxBuffer: 1024 * 1024 });
      const streams = JSON.parse(result.stdout).streams;
      videoCodec = streams.find(s => s.codec_type === 'video')?.codec_name || 'h264';
      const tracks = streams.filter(s => s.codec_type === 'audio');
      const english = tracks.find(s => /^(en|eng|english)$/i.test(s.tags?.language || '') || /english/i.test(s.tags?.title || ''));
      const selectedAudio = english || tracks[0];
      if (selectedAudio) {
        audioIndex = '0:' + selectedAudio.index;
        audioCodec = String(selectedAudio.codec_name || '').toLowerCase();
      }
    } catch { /* The first audio track remains usable when the probe is unavailable. */ }

    const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-readrate', '1',
      '-user_agent', 'DiscordStreamHub/1.0', '-reconnect', '1', '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5', ...(startPosition > 1 ? ['-ss', startPosition.toFixed(3)] : []), '-i', source.url,
      '-map', '0:v:0', '-map', audioIndex,
      ...(videoCodec === 'h264' ? ['-c:v', 'copy'] : ['-vf', 'scale=854:480:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=854:480:(ow-iw)/2:(oh-ih)/2', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-crf', '27', '-pix_fmt', 'yuv420p']),
      ...(audioCodec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k', '-ac', '2']),
      '-f', 'hls', '-hls_time', '4', '-hls_list_size', '12', '-hls_delete_threshold', '3',
      '-hls_flags', 'independent_segments+temp_file+delete_segments+program_date_time',
      '-hls_segment_filename', join(dir, 'segment_%06d.ts'), join(dir, 'index.m3u8')];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    process = child;
    lastFailed = 0;
    let details = '';
    child.stderr.on('data', chunk => { details = (details + chunk).slice(-1000); });
    child.once('error', err => {
      if (process !== child) return;
      error = err.message;
      lastFailed = Date.now();
    });
    child.once('close', code => {
      // A seek intentionally terminates the previous ffmpeg process while the
      // requestId stays the same. Ignore callbacks from superseded children so
      // they cannot poison or advance the replacement stream.
      if (process !== child) return;
      if (code === 0 && current?.requestId === movie.requestId && Number(current?.seekRevision || 0) === Number(movie.seekRevision || 0)) {
        Promise.resolve(onMovieEnded?.(movie.requestId)).catch(err => console.warn('[Lounge] Movie advance failed:', err?.message || err));
        return;
      }
      if (code !== 0 && current?.requestId === movie.requestId && Number(current?.seekRevision || 0) === Number(movie.seekRevision || 0)) {
        error = details.replace(source.url, '[source]') || 'Movie preparation stopped';
        lastFailed = Date.now();
      }
    });
  }

  async function sync() {
    if (checking) return checking;
    if (Date.now() - lastChecked < 2000) return;
    lastChecked = Date.now();
    checking = (async () => {
      const next = await selectedMovie();
      if (!next) { current = null; await stopActiveProcess(); return; }
      const sameRequest = next.requestId === current?.requestId;
      const seekChanged = sameRequest
        && Number(next.seekRevision || 0) !== Number(current?.seekRevision || 0);
      const recovering = sameRequest && !seekChanged && error && Date.now() - lastFailed > 12000;
      if (recovering && current) {
        const elapsed = Math.max(0, (Date.now() - Number(current.captureStartedAt || Date.now())) / 1000);
        const lastKnownPosition = Math.max(0, Number(current.captureStartPosition || 0) + elapsed);
        next.playbackPosition = Math.max(Number(next.playbackPosition || 0), lastKnownPosition);
      }
      if (!sameRequest || seekChanged || recovering) {
        current = next;
        try { await start(next); } catch (failure) { error = failure.message; lastFailed = Date.now(); }
      }
    })().finally(() => { checking = null; });
    return checking;
  }

  async function status() {
    await sync();
    if (!current) return { active: false };
    const dir = join(folder, current.requestId.replace(/[^a-zA-Z0-9_-]/g, ''));
    const path = join(dir, 'index.m3u8');
    const manifest = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const segments = manifest.split(/\r?\n/).filter(line => /^segment_\d+\.ts$/.test(line));
    const durations = [...manifest.matchAll(/#EXTINF:([\d.]+)/g)].map(match => Number(match[1]));
    const bufferedSeconds = durations.reduce((sum, seconds) => sum + seconds, 0);
    const programTimes = [...manifest.matchAll(/#EXT-X-PROGRAM-DATE-TIME:([^\r\n]+)/g)];
    const lastStart = Date.parse(programTimes.at(-1)?.[1] || '');
    const lastEnd = lastStart + (durations.at(-1) || 0) * 1000;
    const lagSeconds = Number.isFinite(lastEnd) ? Math.max(0, (Date.now() - lastEnd) / 1000) : Infinity;
    const manifestAgeSeconds = existsSync(path) ? Math.max(0, (Date.now() - statSync(path).mtimeMs) / 1000) : Infinity;
    const streamFresh = lagSeconds <= 30 && manifestAgeSeconds <= 30;
    const captureElapsed = Math.max(0, (Date.now() - Number(current.captureStartedAt || Date.now())) / 1000);
    const playbackPosition = Math.max(0, Number(current.captureStartPosition || 0) + captureElapsed);
    const mediaSequence = Math.max(0, Number(manifest.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1] || 0));
    const lastSegment = Number(segments.at(-1)?.match(/segment_(\d+)\.ts/)?.[1] ?? -1);
    const streamKey = streamKeyForGeneration(current.requestId, current.generation);
    if (streamKey !== lastObservedStreamKey) {
      lastObservedStreamKey = streamKey;
      lastObservedSegment = -1;
      lastSegmentAdvanceAt = Date.now();
    }
    if (Number.isFinite(lastSegment) && lastSegment > lastObservedSegment) {
      lastObservedSegment = lastSegment;
      lastSegmentAdvanceAt = Date.now();
    }
    const stalledMs = lastSegmentAdvanceAt ? Date.now() - lastSegmentAdvanceAt : 0;
    if (segments.length >= 2 && process?.exitCode === null && stalledMs > 25000 && !error) {
      error = 'Movie HLS stopped advancing';
      lastFailed = Date.now() - 12001;
      console.warn(`[LoungeHLS] stalled request=${safeHlsToken(current.requestId)} generation=${current.generation} lastSegment=${lastSegment} manifestAge=${manifestAgeSeconds.toFixed(1)}s`);
    }
    const ready = segments.length >= 2 && bufferedSeconds >= 12 && streamFresh;
    if (Date.now() - lastTelemetryAt >= 15000) {
      lastTelemetryAt = Date.now();
      console.log(`[LoungeHLS] request=${safeHlsToken(current.requestId)} generation=${current.generation} mediaSequence=${mediaSequence} lastSegment=${lastSegment} position=${playbackPosition.toFixed(1)} manifestAge=${Number.isFinite(manifestAgeSeconds) ? manifestAgeSeconds.toFixed(1) : 'na'}s lag=${Number.isFinite(lagSeconds) ? lagSeconds.toFixed(1) : 'na'}s ready=${ready}`);
    }
    return { active: true, requestId: current.requestId, generation: current.generation, streamKey, title: current.title, requester: current.requester,
      ready, bufferedSeconds: Math.round(bufferedSeconds),
      segmentCount: segments.length, mediaSequence, lastSegment,
      lagSeconds: Number.isFinite(lagSeconds) ? Math.round(lagSeconds) : null,
      playbackPosition, viewerPosition: captureElapsed,
      error: error || (!streamFresh && segments.length ? 'Movie stream is behind the live queue' : null) };
  }

  async function file(name, res) {
    const state = await status();
    if (!state.active) return res.status(404).json({ error: 'No movie selected' });
    if (!state.ready) return res.status(202).json({ error: state.error || 'Preparing movie', bufferedSeconds: state.bufferedSeconds });
    const dir = join(folder, safeHlsToken(state.requestId));
    if (name === 'index.m3u8') {
      const path = join(dir, 'index.m3u8');
      if (!existsSync(path) || !statSync(path).isFile()) return res.status(404).end();
      const manifest = rewriteManifestForGeneration(readFileSync(path, 'utf8'), state.requestId, state.generation);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(manifest);
    }
    const segment = internalSegmentName(name, state.requestId, state.generation);
    if (!segment) return res.status(400).end();
    const path = join(dir, segment);
    if (!existsSync(path) || !statSync(path).isFile()) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
    res.setHeader('Content-Type', 'video/mp2t');
    return createReadStream(path).pipe(res);
  }

  async function fileForGeneration(streamKey, name, res) {
    const state = await status();
    if (!state.active) return res.status(404).json({ error: 'No movie selected' });
    if (!state.ready) return res.status(202).json({ error: state.error || 'Preparing movie', bufferedSeconds: state.bufferedSeconds });
    if (String(streamKey || '') !== state.streamKey) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(410).end();
    }
    if (!/^(?:index\.m3u8|segment_\d{6}\.ts)$/.test(name)) return res.status(400).end();
    const dir = join(folder, safeHlsToken(state.requestId));
    const path = join(dir, name);
    if (!existsSync(path) || !statSync(path).isFile()) return res.status(404).end();
    res.setHeader('Cache-Control', name.endsWith('.m3u8') ? 'no-store' : 'public, max-age=3600, immutable');
    res.setHeader('Content-Type', name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    if (name.endsWith('.m3u8')) return res.send(readFileSync(path, 'utf8'));
    return createReadStream(path).pipe(res);
  }
  return { status, file, fileForGeneration };
}

module.exports = { createDirectLounge, streamKeyForGeneration, rewriteManifestForGeneration, internalSegmentName };
