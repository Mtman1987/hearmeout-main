'use strict';

const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const run = promisify(execFile);
const stateFile = process.env.LOUNGE_STATE_FILE || '/data/lounge-program.json';
let catalog = { at: 0, items: [] };
let state;

function emptyLane() {
  return { current: null, queue: [], playback: { status: 'idle', position: 0, updatedAt: Date.now(), muted: false, volume: 85 } };
}

function readState() {
  if (state) return state;
  try {
    const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (saved?.movie?.queue && saved?.music?.queue) return (state = saved);
  } catch (error) {
    if (existsSync(stateFile)) throw error;
  }
  return (state = { movie: emptyLane(), music: emptyLane() });
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
    playback: lane.playback,
    queue: [],
  };
}

function program() {
  const stored = readState();
  return { movie: publicLane(stored.movie), music: publicLane(stored.music) };
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

async function musicItem(query) {
  const value = String(query || '').trim();
  if (!value) throw Error('A song or YouTube URL is required');
  const input = /^https?:\/\//i.test(value) ? value : `ytsearch1:${value}`;
  const { stdout } = await run('yt-dlp', ['--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings', input], { timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
  const found = JSON.parse(stdout);
  const video = Array.isArray(found.entries) ? found.entries[0] : found;
  if (!/^[\w-]{11}$/.test(String(video?.id || ''))) throw Error('No playable song found');
  return { type: 'music', title: String(video.title || value), playbackUrl: `/lounge/music/hls/index.m3u8`,
    metadata: { provider: 'youtube', videoId: video.id, artist: video.uploader || video.channel || '' } };
}

async function request(body) {
  const laneName = body.lane === 'movie' ? 'movie' : 'music';
  const item = laneName === 'movie' ? await movieItem(body.query, body.itemId) : await musicItem(body.query);
  const stored = readState();
  const lane = stored[laneName];
  const entry = { requestId: randomUUID(), requestedBy: { userId: String(body.actorUserId || ''), username: String(body.actorName || 'Viewer') }, addedAt: new Date().toISOString(), item };
  if (!lane.current) {
    lane.current = entry;
    lane.playback = { ...lane.playback, status: 'playing', position: 0, updatedAt: Date.now() };
    const other = stored[laneName === 'movie' ? 'music' : 'movie'];
    if (other.current && other.playback.status === 'playing') other.playback.status = 'paused';
  } else lane.queue.push(entry);
  save();
  return { success: true, action: 'hmo.media.request', message: `Queued up: "${item.title}"`, request: entry, session: publicLane(lane) };
}

function control(body) {
  const stored = readState();
  const laneName = body.lane === 'movie' ? 'movie' : 'music';
  const lane = stored[laneName];
  const action = String(body.control || '');
  if (action === 'next') lane.current = lane.queue.shift() || null;
  else if (action === 'clear') { lane.current = null; lane.queue = []; }
  else if (action === 'play' || action === 'pause') lane.playback.status = lane.current ? (action === 'play' ? 'playing' : 'paused') : 'idle';
  else if (action === 'volume') lane.playback.volume = Math.max(0, Math.min(100, Number(body.value) || 0));
  else if (action === 'mute' || action === 'unmute') lane.playback.muted = action === 'mute';
  else throw Error('Unsupported Lounge control');
  if (action === 'next' || action === 'clear') lane.playback.status = lane.current ? 'playing' : 'idle';
  if (!lane.current) {
    const other = stored[laneName === 'movie' ? 'music' : 'movie'];
    if (other.current && other.playback.status === 'paused') other.playback.status = 'playing';
  }
  lane.playback.position = 0;
  lane.playback.updatedAt = Date.now();
  save();
  return { success: true, action: 'hmo.media.control', session: publicLane(lane) };
}

function source(movie) {
  const metadata = movie?.current?.item?.metadata;
  if (!metadata || !/^\d+$/.test(String(metadata.streamId)) || !/^[a-z0-9]+$/.test(String(metadata.extension))) throw Error('No provider source selected');
  const { base, username, password } = provider();
  return new URL(`/${metadata.pathKind}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${metadata.streamId}.${metadata.extension}`, base).toString();
}

module.exports = { program, search, request, control, source };
