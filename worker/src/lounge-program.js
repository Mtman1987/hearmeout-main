'use strict';

const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const run = promisify(execFile);
const stateFile = process.env.LOUNGE_STATE_FILE || '/data/lounge-program.json';
const MAX_RADIO_SEEDS = 1000;
let catalog = { at: 0, items: [] };
let state;
let durationLookup = null;
let durationRetryAt = 0;
let radioAdvance = null;
let prefetchedRadio = null;
let radioPrefetch = null;
let currentMusicPreparation = null;
let awaitingMusicSource = null;
let musicSource = { prepare: async () => true, stop: () => {} };

function configureMusicSource(source) {
  musicSource = source;
}

function emptyLane() {
  return { current: null, queue: [], playback: { status: 'idle', position: 0, updatedAt: Date.now(), muted: false, volume: 85, seekRevision: 0 } };
}

function livePlayback(playback, now = Date.now()) {
  const base = Math.max(0, Number(playback?.position || 0));
  const updatedAt = Number(playback?.updatedAt || now);
  const elapsed = playback?.status === 'playing' ? Math.max(0, (now - updatedAt) / 1000) : 0;
  return { ...playback, position: base + elapsed, updatedAt: playback?.status === 'playing' ? now : updatedAt };
}

function readState() {
  if (state) return state;
  try {
    const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (saved?.movie?.queue && saved?.music?.queue) return (state = saved);
  } catch (error) {
    if (existsSync(stateFile)) throw error;
  }
  return (state = { movie: emptyLane(), music: emptyLane(), radio: { enabled: false, seeds: [], cursor: 0 } });
}

function save() {
  mkdirSync(dirname(stateFile), { recursive: true });
  const temp = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(readState()));
  renameSync(temp, stateFile);
}

function publicLane(lane) {
  return {
    current: lane.current && {
      requestId: lane.current.requestId,
      requestedBy: { username: lane.current.requestedBy.username },
      item: lane.current.item,
    },
    playback: livePlayback(lane.playback),
    queue: [],
    queueCount: lane.queue.length,
  };
}

function program() {
  const stored = readState();
  return { movie: publicLane(stored.movie), music: publicLane(stored.music), radio: { enabled: stored.radio?.enabled === true, seedCount: stored.radio?.seeds?.length || 0, recentCount: stored.radio?.history?.length || 0, mode: 'recent-music' } };
}

function provider() {
  const base = process.env.XTREAM_BASE_URL;
  const username = process.env.XTREAM_USERNAME;
  const password = process.env.XTREAM_PASSWORD;
  if (!base || !username || !password) throw Error('Lounge movie provider is not configured on the Lounge worker');
  return { base, username, password };
}

function apiUrl(action, extra = {}) {
  const { base, username, password } = provider();
  const url = new URL('/player_api.php', base);
  url.searchParams.set('username', username);
  url.searchParams.set('password', password);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, String(value));
  return url;
}

async function providerJson(action, extra) {
  const response = await fetch(apiUrl(action, extra), { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw Error(`Movie provider returned ${response.status}`);
  return response.json();
}

function cleanMovie(raw, kind) {
  const id = String(kind === 'series' ? raw.series_id : raw.stream_id || '');
  const title = String(raw.name || raw.title || '').trim();
  if (!/^\d+$/.test(id) || !title) return null;
  const ext = String(raw.container_extension || 'mp4').toLowerCase();
  if (kind === 'vod' && !/^(mp4|m4v|mov|mkv|ts|m3u8)$/.test(ext)) return null;
  return { id: `xtream-${kind}-${id}`, title, year: Number(raw.year) || null, extension: ext, kind, streamId: id };
}

async function movies() {
  if (catalog.items.length && Date.now() - catalog.at < 10 * 60_000) return catalog.items;
  const [vod, series] = await Promise.all([
    providerJson('get_vod_streams'),
    process.env.XTREAM_ENABLE_SERIES === 'false' ? [] : providerJson('get_series').catch(() => []),
  ]);
  catalog = { at: Date.now(), items: [
    ...(Array.isArray(vod) ? vod : []).map(item => cleanMovie(item, 'vod')),
    ...(Array.isArray(series) ? series : []).map(item => cleanMovie(item, 'series')),
  ].filter(Boolean) };
  return catalog.items;
}

async function search(query) {
  const words = String(query || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!words.length) return [];
  return (await movies()).map(item => {
    const title = item.title.toLowerCase();
    const score = words.reduce((sum, word) => sum + (title.includes(word) ? 1 : 0), 0);
    return { item, score: score + (title === words.join(' ') ? 5 : 0) };
  }).filter(entry => entry.score >= words.length)
    .sort((a, b) => b.score - a.score || a.item.title.length - b.item.title.length)
    .slice(0, 3).map(({ item }) => ({ id: item.id, title: item.title, year: item.year }));
}

async function movieItem(query, itemId) {
  const selectedId = itemId || (await search(query))[0]?.id;
  const item = selectedId ? (await movies()).find(entry => entry.id === selectedId) : null;
  if (!item) throw Error('No playable movie found');
  let selected = item;
  if (item.kind === 'series') {
    const info = await providerJson('get_series_info', { series_id: item.streamId });
    const groups = info?.episodes && typeof info.episodes === 'object' ? Object.values(info.episodes) : [];
    const first = groups.flat().find(entry => /^\d+$/.test(String(entry?.id || entry?.stream_id || '')));
    if (!first) throw Error('Series has no playable episode');
    selected = { ...item, kind: 'series', streamId: String(first.id || first.stream_id), extension: String(first.container_extension || 'mp4').toLowerCase(), title: `${item.title} - ${first.title || 'Episode 1'}` };
  }
  const pathKind = selected.kind === 'series' ? 'series' : 'movie';
  return { type: 'movie', title: selected.title, playbackUrl: `/api/watch/xtream/hls/${selected.kind}-${selected.streamId}/index.m3u8`,
    metadata: { provider: 'xtream', kind: selected.kind, streamId: selected.streamId, extension: selected.extension, pathKind } };
}

async function musicItem(query, timeout = 45000) {
  const value = String(query || '').trim();
  if (!value) throw Error('A song or YouTube URL is required');
  const input = /^https?:\/\//i.test(value) ? value : `ytsearch1:${value}`;
  const { stdout } = await run('yt-dlp', ['--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings', input], { timeout, maxBuffer: 8 * 1024 * 1024 });
  const found = JSON.parse(stdout);
  const video = Array.isArray(found.entries) ? found.entries[0] : found;
  if (!/^[\w-]{11}$/.test(String(video?.id || ''))) throw Error('No playable song found');
  return { type: 'music', title: String(video.title || value), playbackUrl: `/lounge/music/hls/${video.id}/index.m3u8`,
    metadata: { provider: 'youtube', videoId: video.id, artist: video.uploader || video.channel || '', duration: Number(video.duration) || 0 } };
}

// Try other uploads of the requested song when the first source cannot be
// packaged. Never switch to a different track just to keep the radio moving.
async function playableMusicItem(item) {
  if (await musicSource.prepare(item.metadata.videoId)) return item;
  if (!musicSource.failure?.(item.metadata.videoId)) return null;
  musicSource.stop(item.metadata.videoId);
  const query = String(item.title || '').slice(0, 150);
  const words = title => new Set(String(title || '').toLowerCase()
    .replace(/\b(?:official|audio|video|lyrics?|visualizer|hd|hq)\b/g, ' ')
    .match(/[a-z0-9]{2,}/g) || []);
  const expected = words(query);
  let candidates = [];
  try {
    const { stdout } = await run('yt-dlp', ['--flat-playlist', '--skip-download', '--dump-single-json', '--no-warnings', `ytsearch5:${query}`], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    candidates = JSON.parse(stdout).entries || [];
  } catch (error) { console.warn('[Lounge] Alternate song search:', error.message); }
  for (const video of candidates.slice(0, 5)) {
    const id = String(video?.id || '');
    if (!/^[\w-]{11}$/.test(id) || id === item.metadata.videoId) continue;
    const matched = [...expected].filter(word => words(video.title).has(word)).length;
    if (expected.size && matched < Math.max(1, Math.ceil(expected.size * 0.6))) continue;
    const alternate = { ...item, title: String(video.title || item.title), playbackUrl: `/lounge/music/hls/${id}/index.m3u8`,
      metadata: { ...item.metadata, videoId: id, artist: video.uploader || video.channel || item.metadata.artist,
        duration: Number(video.duration) || item.metadata.duration } };
    try {
      if (!await musicSource.prepare(id)) {
        if (musicSource.failure?.(id)) { musicSource.stop(id); continue; }
        return alternate;
      }
      console.log(`[Lounge] Using playable alternate ${id} for ${item.metadata.videoId}`);
      return alternate;
    } catch (error) { console.warn(`[Lounge] Alternate ${id} unavailable:`, error.message); }
  }
  const error = Error(`Could not find a playable upload of "${query}" after checking the top five results`);
  error.songTitle = query;
  throw error;
}

function radioState() {
  const stored = readState();
  if (!stored.radio) stored.radio = { enabled: false, seeds: [], cursor: 0 };
  if (!Array.isArray(stored.radio.history)) stored.radio.history = [];
  return stored.radio;
}

function rememberPlayed(entry) {
  const id = String(entry?.item?.metadata?.videoId || '');
  if (!/^[\w-]{11}$/.test(id)) return;
  const radio = radioState();
  radio.playedIds ||= [];
  radio.playedIds.push(id);
  radio.playedIds = radio.playedIds.slice(-30);
  if (entry.requestedBy?.userId !== 'auto-radio') {
    const history = radio.history;
    history.push({ id, title: String(entry.item.title || ''), artist: String(entry.item.metadata.artist || ''), duration: Number(entry.item.metadata.duration) || 0, playedAt: Date.now() });
    if (history.length > 30) history.splice(0, history.length - 30);
  }
  if (prefetchedRadio?.entry?.item?.metadata?.videoId && prefetchedRadio.entry.item.metadata.videoId !== id)
    musicSource.stop(prefetchedRadio?.entry?.item?.metadata?.videoId);
  prefetchedRadio = null;
}

function rememberSong(item) {
  const radio = radioState();
  const id = String(item?.metadata?.videoId || '');
  if (!/^[\w-]{11}$/.test(id)) return;
  if (radio.seeds.some(seed => seed.id === id)) return;
  radio.seeds.push({ id, title: item.title, artist: item.metadata.artist || '', duration: item.metadata.duration || 0 });
  if (radio.seeds.length > MAX_RADIO_SEEDS) { radio.seeds.shift(); radio.cursor = Math.max(0, radio.cursor - 1); }
}

function radioEntry(song) {
  return { requestId: randomUUID(), requestedBy: { userId: 'auto-radio', username: 'Auto-Radio' }, addedAt: new Date().toISOString(),
    item: { type: 'music', title: song.title, playbackUrl: `/lounge/music/hls/${song.id}/index.m3u8`,
      metadata: { provider: 'youtube', videoId: song.id, artist: song.artist || '', duration: Number(song.duration) || 0 } } };
}

function playlistStarter() {
  const radio = radioState();
  if (!radio.seeds.length) return null;
  // Visit the whole reference library in a spread-out order. Sampling only
  // six positions caused a 480-song playlist to loop those same six songs.
  const count = radio.seeds.length;
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  let step = count > 6 ? Math.floor(count / 6) : 1;
  while (gcd(step, count) !== 1) step++;
  const recentlyHeard = new Set((radio.playedIds || []).slice(-Math.min(count - 1, 30)));
  const cursor = Number(radio.cursor) || 0;
  let index = cursor % count;
  for (let attempt = 0; attempt < count - 1 && recentlyHeard.has(radio.seeds[index * step % count].id); attempt++) index = (index + 1) % count;
  const selected = radio.seeds[index * step % count];
  radio.cursor = (index + 1) % count;
  return radioEntry(selected);
}

function humanFallback() {
  const radio = radioState();
  const recentIds = new Set((radio.playedIds || []).slice(-Math.max(0, radio.history.length - 1)));
  const chosen = radio.history.slice().reverse().find(song => !recentIds.has(song.id)) || radio.history.at(-1);
  return chosen ? radioEntry(chosen) : null;
}

async function discoverRadioEntry() {
  const radio = radioState();
  if (!radio.enabled) return null;
  const recent = radio.history.slice(-6);
  const roomHasProfile = new Set(radio.history.map(song => song.id)).size >= 3;
  // Two recent anchors are enough to follow changes in the room without
  // repeatedly searching all 480 playlist entries or issuing unbounded calls.
  const anchors = [recent.at(-1), recent.slice(0, -1).reverse().find(song => song.artist && song.artist !== recent.at(-1)?.artist)].filter(Boolean);
  const blocked = new Set((radio.playedIds || []).slice(-20));
  if (!roomHasProfile && radio.seeds.length) {
    const starter = playlistStarter();
    if (starter) return starter;
  }
  for (const anchor of anchors) {
    const artist = String(anchor.artist || '').replace(/\b(?:VEVO|Topic|Official)\b/ig, '').trim();
    if (!artist) continue;
    try {
      const query = `ytsearch8:${artist} songs like ${String(anchor.title || '').slice(0, 70)}`;
      const { stdout } = await run('yt-dlp', ['--flat-playlist', '--skip-download', '--dump-single-json', '--no-warnings', query], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
      const results = JSON.parse(stdout);
      const candidates = (Array.isArray(results.entries) ? results.entries : [])
        .filter(video => /^[\w-]{11}$/.test(String(video?.id || '')) && !blocked.has(video.id))
        .filter(video => !/\b(?:playlist|full album|hour mix|livestream|reaction)\b/i.test(String(video.title || '')))
        .filter(video => !Number(video.duration) || Number(video.duration) >= 80 && Number(video.duration) <= 540);
      for (const video of candidates.slice(0, 1)) {
        try {
          const item = await musicItem(`https://www.youtube.com/watch?v=${video.id}`, 20000);
          if (!blocked.has(item.metadata.videoId) && (!item.metadata.duration || item.metadata.duration <= 540))
            return radioEntry({ id: item.metadata.videoId, title: item.title, artist: item.metadata.artist, duration: item.metadata.duration });
        } catch (error) { console.warn('[Lounge] Radio candidate unavailable:', error.message); }
      }
    } catch (error) { console.warn('[Lounge] Radio discovery unavailable:', error.message); }
  }
  return roomHasProfile ? humanFallback() : playlistStarter() || humanFallback();
}

function prefetchNextRadio() {
  const lane = readState().music;
  if (!radioState().enabled || !lane.current || lane.queue.length || musicSource.isReady && !musicSource.isReady(lane.current.item.metadata.videoId)) return;
  const forRequestId = lane.current.requestId;
  if (prefetchedRadio?.forRequestId === forRequestId || radioPrefetch?.forRequestId === forRequestId) return;
  const promise = discoverRadioEntry().then(async entry => {
    let ready = false;
    if (entry && readState().music.current?.requestId === forRequestId && radioState().enabled) {
      const playable = await playableMusicItem(entry.item);
      if (playable) { entry.item = playable; ready = true; }
    }
    if (entry && readState().music.current?.requestId === forRequestId && radioState().enabled && !readState().music.queue.length)
      prefetchedRadio = { forRequestId, entry, ready };
    else if (entry?.item?.metadata?.videoId !== readState().music.current?.item?.metadata?.videoId)
      musicSource.stop(entry?.item?.metadata?.videoId);
    return entry;
  }).catch(error => {
    console.warn('[Lounge] Radio prefetch failed:', error.message);
    if (error.songTitle) musicSource.notifyFailure?.(error.songTitle);
    return null;
  })
    .finally(() => { if (radioPrefetch?.forRequestId === forRequestId) radioPrefetch = null; });
  radioPrefetch = { forRequestId, promise };
}

async function advanceMusic() {
  if (radioAdvance) return radioAdvance;
  radioAdvance = (async () => {
  const stored = readState();
  const lane = stored.music;
  const previous = lane.current;
  let next = lane.queue.shift();
  if (!next && radioState().enabled) {
    if (previous && radioPrefetch?.forRequestId === previous.requestId) await radioPrefetch.promise;
    next = prefetchedRadio?.forRequestId === (previous?.requestId || null) ? prefetchedRadio.entry : await discoverRadioEntry();
    if (next) {
      try {
        const playable = await playableMusicItem(next.item);
        if (!playable) {
          prefetchedRadio = { forRequestId: previous?.requestId || null, entry: next, ready: false };
          return;
        }
        next.item = playable;
      }
      catch (error) {
        console.warn('[Lounge] Radio could not prepare song:', error.message);
        if (error.songTitle) musicSource.notifyFailure?.(error.songTitle);
        prefetchedRadio = null;
        return;
      }
    }
  }
  if (lane.current !== previous) return;
  // A human request arriving while discovery was in flight takes priority.
  if (lane.queue.length && (!next || next.requestedBy?.userId === 'auto-radio')) next = lane.queue.shift();
  else if (!radioState().enabled && next?.requestedBy?.userId === 'auto-radio') next = null;
  lane.current = next || null;
  prefetchedRadio = null;
  lane.playback.position = 0;
  lane.playback.updatedAt = Date.now();
  lane.playback.status = lane.current ? 'playing' : 'idle';
  if (lane.current) rememberPlayed(lane.current);
  if (previous?.item?.metadata?.videoId && previous.item.metadata.videoId !== lane.current?.item?.metadata?.videoId)
    musicSource.stop(previous.item.metadata.videoId);
  if (!lane.current && stored.movie.current && stored.movie.playback.status === 'paused') {
    stored.movie.playback.status = 'playing';
    stored.movie.playback.updatedAt = Date.now();
  }
  save();
  })().finally(() => { radioAdvance = null; });
  return radioAdvance;
}

async function radio(body) {
  const stored = readState();
  const settings = radioState();
  const beforeCount = settings.seeds.length;
  const control = String(body.control || 'status');
  if (control === 'add') {
    const value = String(body.query || '').trim();
    const url = new URL(value);
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname) || !url.searchParams.get('list')) throw Error('Provide a public YouTube playlist URL');
    const { stdout } = await run('yt-dlp', ['--flat-playlist', '--playlist-end', String(MAX_RADIO_SEEDS), '--skip-download', '--dump-single-json', '--no-warnings', value], { timeout: 90000, maxBuffer: 24 * 1024 * 1024 });
    const playlist = JSON.parse(stdout);
    const entries = Array.isArray(playlist.entries) ? playlist.entries : [];
    for (const video of entries) {
      if (!/^[\w-]{11}$/.test(String(video?.id || ''))) continue;
      rememberSong({ title: String(video.title || video.id).slice(0, 180), metadata: { videoId: video.id, artist: video.uploader || video.channel || '', duration: Number(video.duration) || 0 } });
    }
    if (settings.seeds.length === beforeCount) throw Error('No new playable videos found in that playlist');
  } else if (control === 'on' || control === 'off') {
    settings.enabled = control === 'on';
    if (settings.enabled) {
      if (stored.music.current) rememberSong(stored.music.current.item);
      for (const queued of stored.music.queue) rememberSong(queued.item);
    }
    if (settings.enabled && stored.music.current && stored.music.current.requestedBy?.userId !== 'auto-radio' && !settings.history.some(song => song.id === stored.music.current.item?.metadata?.videoId)) rememberPlayed(stored.music.current);
    if (settings.enabled && !stored.music.current && !stored.music.queue.length) await advanceMusic();
  } else if (control !== 'status') throw Error('Unsupported radio control');
  save();
  return { success: true, action: 'hmo.media.radio', radio: program().radio, added: control === 'add' ? settings.seeds.length - beforeCount : undefined, program: program() };
}

async function tick(now = Date.now()) {
  const stored = readState();
  const lane = stored.music;
  if (lane.current && lane.playback.status === 'playing') {
    if (musicSource.isReady && !musicSource.isReady(lane.current.item?.metadata?.videoId)) {
      awaitingMusicSource = lane.current.requestId;
      if (currentMusicPreparation?.forRequestId !== lane.current.requestId) {
        const forRequestId = lane.current.requestId;
        const failed = musicSource.failure?.(lane.current.item.metadata.videoId);
        const promise = (failed ? playableMusicItem(lane.current.item) : musicSource.prepare(lane.current.item.metadata.videoId))
          .then(item => {
            if (item && typeof item === 'object' && lane.current?.requestId === forRequestId) {
              lane.current.item = item;
              save();
            }
          })
          .catch(error => {
            console.warn('[Lounge] Current song preparation:', error.message);
            if (error.songTitle) musicSource.notifyFailure?.(error.songTitle);
            if (error.songTitle && lane.current?.requestId === forRequestId) advanceMusic().catch(err => console.warn('[Lounge] Radio recovery:', err.message));
          })
          .finally(() => { if (currentMusicPreparation?.forRequestId === forRequestId) currentMusicPreparation = null; });
        currentMusicPreparation = { forRequestId, promise };
      }
      return;
    }
    if (awaitingMusicSource === lane.current.requestId) {
      lane.playback.position = 0;
      lane.playback.updatedAt = now;
      awaitingMusicSource = null;
      save();
    }
    const duration = Number(lane.current.item?.metadata?.duration);
    if (!duration && !durationLookup && now >= durationRetryAt) {
      const id = lane.current.item?.metadata?.videoId;
      durationRetryAt = now + 60_000;
      durationLookup = musicItem(`https://www.youtube.com/watch?v=${id}`).then(item => {
        if (lane.current?.item?.metadata?.videoId === id && item.metadata.duration > 0) {
          lane.current.item.metadata.duration = item.metadata.duration;
          for (const seed of radioState().seeds) if (seed.id === id) seed.duration = item.metadata.duration;
          save();
        }
      }).catch(error => console.warn('[Lounge] Radio duration lookup:', error.message))
        .finally(() => { durationLookup = null; });
    }
    if (duration > 0 && lane.playback.position + (now - lane.playback.updatedAt) / 1000 >= duration) {
      await advanceMusic();
    }
  } else if (!lane.current && stored.radio?.enabled && (stored.radio.seeds?.length || stored.radio.history?.length)) {
    await advanceMusic();
  }
  if (lane.current && lane.playback.status === 'playing' && stored.radio?.enabled && !lane.queue.length) prefetchNextRadio();
}

async function request(body) {
  const laneName = body.lane === 'movie' ? 'movie' : 'music';
  const requested = laneName === 'movie' ? await movieItem(body.query, body.itemId) : await musicItem(body.query);
  const item = laneName === 'movie' ? requested : await playableMusicItem(requested) || requested;
  const stored = readState();
  if (laneName === 'music') rememberSong(item);
  const lane = stored[laneName];
  const entry = { requestId: randomUUID(), requestedBy: { userId: String(body.actorUserId || ''), username: String(body.actorName || 'Viewer') }, addedAt: new Date().toISOString(), item };
  if (!lane.current) {
    lane.current = entry;
    lane.playback = { ...lane.playback, status: 'playing', position: 0, updatedAt: Date.now() };
    const other = stored[laneName === 'movie' ? 'music' : 'movie'];
    if (other.current && other.playback.status === 'playing') {
      const paused = livePlayback(other.playback);
      other.playback.position = paused.position;
      other.playback.updatedAt = Date.now();
      other.playback.status = 'paused';
    }
    if (laneName === 'music') rememberPlayed(entry);
  } else lane.queue.push(entry);
  save();
  return { success: true, action: 'hmo.media.request', message: `Queued up: "${item.title}"`, request: entry, session: publicLane(lane) };
}

async function control(body) {
  const stored = readState();
  const requestedLane = body.lane === 'movie' ? 'movie' : 'music';
  const laneName = body.control === 'next-active' && !body.targetLane
    ? (stored.movie.current && stored.movie.playback.status === 'playing' ? 'movie'
      : stored.music.current && stored.music.playback.status === 'playing' ? 'music'
        : stored[requestedLane].current ? requestedLane : stored.movie.current ? 'movie' : requestedLane)
    : body.targetLane === 'movie' ? 'movie' : requestedLane;
  const lane = stored[laneName];
  const previousMusicId = laneName === 'music' ? lane.current?.item?.metadata?.videoId : null;
  const action = body.control === 'next-active' ? 'next' : String(body.control || '');
  if (action === 'next' && laneName === 'music') await advanceMusic();
  else if (action === 'next') lane.current = lane.queue.shift() || null;
  else if (action === 'clear') { lane.current = null; lane.queue = []; if (laneName === 'music') radioState().enabled = false; }
  else if (action === 'play' || action === 'pause') {
    if (lane.playback.status === 'playing') lane.playback.position += (Date.now() - lane.playback.updatedAt) / 1000;
    lane.playback.status = lane.current ? (action === 'play' ? 'playing' : 'paused') : 'idle';
  }
  else if (action === 'seek' || action === 'forward' || action === 'rewind') {
    if (!lane.current) throw Error('Nothing is playing in that Lounge lane');
    const currentPosition = livePlayback(lane.playback).position;
    const requested = Number(body.value ?? body.position);
    if (!Number.isFinite(requested)) throw Error('A finite playback position is required');
    lane.playback.position = Math.max(0, action === 'seek' ? requested : currentPosition + (action === 'forward' ? requested : -requested));
    lane.playback.seekRevision = Number(lane.playback.seekRevision || 0) + 1;
  }
  else if (action === 'volume') lane.playback.volume = Math.max(0, Math.min(100, Number(body.value) || 0));
  else if (action === 'mute' || action === 'unmute') lane.playback.muted = action === 'mute';
  else throw Error('Unsupported Lounge control');
  if (action === 'next' || action === 'clear') lane.playback.status = lane.current ? 'playing' : 'idle';
  if (!lane.current) {
    const other = stored[laneName === 'movie' ? 'music' : 'movie'];
    if (other.current && other.playback.status === 'paused') {
      other.playback.status = 'playing';
      other.playback.updatedAt = Date.now();
    }
  }
  if (action === 'next' || action === 'clear') lane.playback.position = 0;
  if (action === 'clear' && laneName === 'music') {
    if (prefetchedRadio?.entry?.item?.metadata?.videoId) musicSource.stop(prefetchedRadio.entry.item.metadata.videoId);
    if (previousMusicId) musicSource.stop(previousMusicId);
    prefetchedRadio = null;
  }
  lane.playback.updatedAt = Date.now();
  save();
  return { success: true, action: 'hmo.media.control', lane: laneName, session: publicLane(lane), program: program() };
}

function source(movie) {
  const metadata = movie?.current?.item?.metadata;
  if (!metadata || !/^\d+$/.test(String(metadata.streamId)) || !/^[a-z0-9]+$/.test(String(metadata.extension))) throw Error('No provider source selected');
  const { base, username, password } = provider();
  return new URL(`/${metadata.pathKind}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${metadata.streamId}.${metadata.extension}`, base).toString();
}

module.exports = { program, search, request, control, radio, tick, source, configureMusicSource };
