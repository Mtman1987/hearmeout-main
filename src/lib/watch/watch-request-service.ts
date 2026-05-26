import { isXtreamMockEnabled, searchXtreamCatalog } from './xtream-provider';
import { findInternetArchiveRecommendation } from './internet-archive-provider';
import { findWatchmodeRecommendation } from './watchmode-provider';
import { DISCORD_CLIENT_ID } from '@/lib/public-config';
import { getGlobalWatchSessionId } from '@/lib/watch-session';
import { dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';

type WatchCatalogItem = {
  id: string;
  type: 'movie' | 'live';
  title: string;
  year: number;
  runtime: string;
  source: string;
  poster: string;
  playbackUrl: string;
  overview: string;
};

type WatchRequest = {
  requestId: string;
  requestedBy: {
    userId: string;
    username: string;
  };
  addedAt: string;
  item: WatchCatalogItem;
};

type WatchSession = {
  id: string;
  guildId: string;
  channelId: string;
  queue: WatchRequest[];
  current: WatchRequest | null;
  playback: {
    status: 'idle' | 'paused' | 'playing';
    position: number;
    updatedAt: number;
  };
  events: Array<{
    id: string;
    at: string;
    message: string;
  }>;
};

const TEST_CATALOG: WatchCatalogItem[] = [
  {
    id: 'bbb',
    type: 'movie',
    title: 'Big Buck Bunny',
    year: 2008,
    runtime: '10m',
    source: 'Public MP4 test stream',
    poster: 'https://peach.blender.org/wp-content/uploads/title_anouncement.jpg',
    playbackUrl: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',
    overview: 'A short open movie MP4 stream commonly used for playback testing.',
  },
  {
    id: 'sintel',
    type: 'movie',
    title: 'Sintel',
    year: 2010,
    runtime: '15m',
    source: 'Shaka public HLS test stream',
    poster: 'https://durian.blender.org/wp-content/uploads/2010/05/sintel_poster.jpg',
    playbackUrl: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
    overview: 'A public HLS test asset used to validate adaptive playback.',
  },
  {
    id: 'tears-of-steel',
    type: 'movie',
    title: 'Tears of Steel',
    year: 2012,
    runtime: '12m',
    source: 'Mux public HLS test stream',
    poster: 'https://mango.blender.org/wp-content/uploads/2013/05/01_thom_celia_bridge.jpg',
    playbackUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    overview: 'A public HLS test stream useful for validating playback and seeking.',
  },
  {
    id: 'mux-hls-test',
    type: 'live',
    title: 'HLS Stream Test',
    year: 2026,
    runtime: 'live',
    source: 'Mux public HLS test stream',
    poster: '',
    playbackUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    overview: 'Adaptive HLS sample for testing provider-style playback URLs.',
  },
];

declare global {
  // eslint-disable-next-line no-unused-vars
  var __watchRequestSessions: Map<string, WatchSession> | undefined;
}

const sessions = globalThis.__watchRequestSessions || new Map<string, WatchSession>();
globalThis.__watchRequestSessions = sessions;
const pendingRecommendations = new Map<string, WatchCatalogItem>();
const WATCH_STATE_FILE = process.env.WATCH_STATE_FILE || (process.env.FLY_APP_NAME ? '/data/watch-state.json' : './data/watch-state.json');
let lastLoadedStateMtime = 0;

function ensureWatchStateDir() {
  const dir = dirname(WATCH_STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadWatchStateFromDisk() {
  try {
    if (!existsSync(WATCH_STATE_FILE)) return;
    const raw = readFileSync(WATCH_STATE_FILE);
    const mtime = statSync(WATCH_STATE_FILE).mtimeMs;
    if (mtime && mtime <= lastLoadedStateMtime) return;
    const payload = JSON.parse(raw.toString('utf8')) as {
      sessions?: Array<[string, WatchSession]>;
      pendingRecommendations?: Array<[string, WatchCatalogItem]>;
    };
    sessions.clear();
    for (const [id, session] of payload.sessions || []) sessions.set(id, session);
    pendingRecommendations.clear();
    for (const [key, item] of payload.pendingRecommendations || []) pendingRecommendations.set(key, item);
    lastLoadedStateMtime = mtime || Date.now();
  } catch (error) {
    console.error('[WatchRequest] Failed to load watch state:', error);
  }
}

function saveWatchStateToDisk() {
  try {
    ensureWatchStateDir();
    writeFileSync(WATCH_STATE_FILE, JSON.stringify({
      sessions: Array.from(sessions.entries()),
      pendingRecommendations: Array.from(pendingRecommendations.entries()),
    }, null, 2));
    lastLoadedStateMtime = statSync(WATCH_STATE_FILE).mtimeMs;
  } catch (error) {
    console.error('[WatchRequest] Failed to save watch state:', error);
  }
}

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function getPublicBaseUrl(preferredBaseUrl?: string) {
  if (preferredBaseUrl) return preferredBaseUrl.replace(/\/$/, '');
  const configured =
    process.env.WATCHROOM_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_WATCHROOM_BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.FLY_APP_NAME) return `https://${process.env.FLY_APP_NAME}.fly.dev`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

function getPublicPlaybackUrl(item: WatchCatalogItem) {
  const playbackUrl = item.playbackUrl;
  const xtreamVodMatch = playbackUrl.match(/^\/activity-provider\/xtream\/vod\/(\d+)$/i);
  const isMkv = String(item.overview || '').toLowerCase().includes('(mkv)');
  if (xtreamVodMatch && isMkv) return `/api/watch/xtream/hls/${xtreamVodMatch[1]}/index.m3u8`;
  if (playbackUrl.startsWith('/')) return playbackUrl;
  return `/activity-proxy?url=${encodeURIComponent(playbackUrl)}`;
}

function getPublicWatchRequest(request: WatchRequest) {
  return {
    ...request,
    item: {
      ...request.item,
      playbackUrl: getPublicPlaybackUrl(request.item),
    },
  };
}

function sendDiscordReply(channelId: string, content: string, userMessageId?: string): void {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken || !channelId) return;

  fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      message_reference: userMessageId ? { message_id: userMessageId, fail_if_not_exists: false } : undefined,
    }),
  }).catch((error) => console.error('[WatchRequest] Discord reply failed:', error));
}

function addEvent(session: WatchSession, message: string) {
  session.events.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    message,
  });
  session.events = session.events.slice(0, 30);
}

function createSession(id: string, guildId = 'local', channelId = 'watch'): WatchSession {
  const session: WatchSession = {
    id,
    guildId,
    channelId,
    queue: [],
    current: null,
    playback: {
      status: 'idle',
      position: 0,
      updatedAt: Date.now(),
    },
    events: [],
  };
  sessions.set(id, session);
  saveWatchStateToDisk();
  return session;
}

function enqueue(session: WatchSession, item: WatchCatalogItem, requestedBy: WatchRequest['requestedBy']) {
  const request: WatchRequest = {
    requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    requestedBy,
    addedAt: new Date().toISOString(),
    item,
  };

  if (!session.current) {
    session.current = request;
    session.playback = { status: 'paused', position: 0, updatedAt: Date.now() };
    addEvent(session, `${requestedBy.username} loaded ${item.title}`);
  } else {
    session.queue.push(request);
    addEvent(session, `${requestedBy.username} queued ${item.title}`);
  }

  saveWatchStateToDisk();
  return request;
}

export function parseWatchCommand(message: string) {
  const trimmed = message.trim();
  const match = trimmed.match(/^!(wr|watch)(?:\s+(.+))?$/i);
  if (!match) return null;
  return {
    command: `!${match[1].toLowerCase()}`,
    query: (match[2] || '').trim(),
  };
}

export function parseWatchAcceptCommand(message: string) {
  return /^!(add|accept)$/i.test(message.trim());
}

export function listWatchCatalog() {
  return TEST_CATALOG;
}

export function searchWatchCatalog(query: string | null | undefined) {
  const needle = normalize(query);
  if (!needle) return [];
  const queryWords = needle.split(/\s+/).filter((word) => word.length >= 3 && !['the', 'and'].includes(word));
  if (queryWords.length === 0) return [];

  return TEST_CATALOG.map((item) => {
    const title = normalize(item.title);
    const overview = normalize(item.overview);
    const source = normalize(item.source);
    let score = 0;
    if (title === needle) score += 100;
    if (title.includes(needle)) score += 50;
    if (overview.includes(needle)) score += 10;
    if (source.includes(needle)) score += 10;
    for (const word of queryWords) {
      if (title.includes(word)) score += 8;
      if (overview.includes(word)) score += 2;
      if (source.includes(word)) score += 2;
    }
    return { item, score };
  })
    .filter((entry) => entry.score >= 20)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

export async function searchWatchProviders(query: string | null | undefined) {
  if (isXtreamMockEnabled()) {
    const xtreamMockResults = await searchXtreamCatalog(query).catch((error) => {
      console.error('[WatchRequest] Xtream mock search failed:', error);
      return [];
    });
    if (xtreamMockResults.length) return xtreamMockResults;
  }

  const xtreamResults = await searchXtreamCatalog(query).catch((error) => {
    console.error('[WatchRequest] Xtream search failed:', error);
    return [];
  });
  if (xtreamResults.length) return xtreamResults;

  return searchWatchCatalog(query);
}

export function getWatchCatalogItem(id: string | null | undefined) {
  return TEST_CATALOG.find((item) => item.id === id) || null;
}

export function getWatchSession(sessionId: string, guildId?: string, channelId?: string) {
  loadWatchStateFromDisk();
  const globalSessionId = getGlobalWatchSessionId();
  return sessions.get(globalSessionId) || createSession(globalSessionId, guildId, channelId);
}

async function createDiscordActivityInvite(channelId: string) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken || !channelId || !DISCORD_CLIENT_ID) return null;

  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/invites`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_age: 86400,
        max_uses: 0,
        target_application_id: DISCORD_CLIENT_ID,
        target_type: 2,
        temporary: false,
        unique: true,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.code) {
      console.error('[WatchRequest] Discord activity invite failed:', response.status, payload);
      return null;
    }

    return `https://discord.gg/${payload.code}`;
  } catch (error) {
    console.error('[WatchRequest] Discord activity invite error:', error);
    return null;
  }
}

export function getResolvedWatchSession(sessionId: string, guildId?: string, channelId?: string) {
  return getWatchSession(sessionId, guildId, channelId);
}

export function getWatchSessionId(guildId: string, channelId: string) {
  void guildId;
  void channelId;
  return getGlobalWatchSessionId();
}

export function getWatchRoomUrl(sessionId: string, preferredBaseUrl?: string) {
  return `${getPublicBaseUrl(preferredBaseUrl)}/watch/${sessionId}`;
}

export function getActivityUrl(preferredBaseUrl?: string) {
  return `${getPublicBaseUrl(preferredBaseUrl)}/activity`;
}

export function getPublicWatchSession(session: WatchSession, preferredBaseUrl?: string) {
  return {
    ...session,
    queue: session.queue.map(getPublicWatchRequest),
    current: session.current ? getPublicWatchRequest(session.current) : null,
    roomUrl: getWatchRoomUrl(session.id, preferredBaseUrl),
  };
}

export async function requestWatchItem(params: {
  sessionId: string;
  guildId?: string;
  channelId?: string;
  query?: string;
  itemId?: string;
  userId: string;
  username: string;
}) {
  const item = getWatchCatalogItem(params.itemId) || (await searchWatchProviders(params.query))[0];
  if (!item) {
    const watchmodeRecommendation = await findWatchmodeRecommendation(params.query).catch((error) => {
      console.error('[WatchRequest] Watchmode fallback failed:', error);
      return null;
    });
    if (watchmodeRecommendation) {
      return { error: 'No playable provider item' as const, discovery: watchmodeRecommendation };
    }

    const recommendation = await findInternetArchiveRecommendation(params.query).catch((error) => {
      console.error('[WatchRequest] Internet Archive fallback failed:', error);
      return null;
    });
    if (recommendation) {
      pendingRecommendations.set(`${params.sessionId}:${params.userId}`, recommendation);
      saveWatchStateToDisk();
      return { error: 'No matching provider item' as const, recommendation };
    }
    return { error: 'No matching catalog item' as const };
  }

  const session = getWatchSession(params.sessionId, params.guildId, params.channelId);
  const request = enqueue(session, item, {
    userId: params.userId,
    username: params.username,
  });
  maybePrepareSharedHls(item);

  return { request, session };
}

export function acceptWatchRecommendation(params: {
  sessionId: string;
  guildId?: string;
  channelId?: string;
  userId: string;
  username: string;
}) {
  loadWatchStateFromDisk();
  const key = `${params.sessionId}:${params.userId}`;
  const item = pendingRecommendations.get(key);
  if (!item) return { error: 'No pending recommendation' as const };

  pendingRecommendations.delete(key);
  const session = getWatchSession(params.sessionId, params.guildId, params.channelId);
  const request = enqueue(session, item, {
    userId: params.userId,
    username: params.username,
  });
  maybePrepareSharedHls(item);
  saveWatchStateToDisk();

  return { request, session };
}

function maybePrepareSharedHls(item: WatchCatalogItem) {
  const match = item.playbackUrl.match(/^\/activity-provider\/xtream\/vod\/(\d+)$/);
  if (!match) return;
  if (!String(item.overview || '').toLowerCase().includes('(mkv)')) return;
  fetch(`${getPublicBaseUrl()}/api/watch/xtream/hls/${match[1]}/index.m3u8`).catch((error) => {
    console.error('[WatchRequest] Xtream shared HLS start failed:', error?.message || error);
  });
}

export function controlWatchSession(sessionId: string, action: string, position?: number, targetIndex?: number) {
  const session = getWatchSession(sessionId);

  if (action === 'play' || action === 'pause') {
    session.playback.status = action === 'play' ? 'playing' : 'paused';
    const nextPosition = position === undefined ? session.playback.position || 0 : position;
    session.playback.position = Math.max(0, Number(nextPosition || 0));
    session.playback.updatedAt = Date.now();
    addEvent(session, `${action === 'play' ? 'Played' : 'Paused'} ${session.current?.item.title || 'session'}`);
    saveWatchStateToDisk();
    return session;
  }

  if (action === 'seek') {
    session.playback.position = Math.max(0, Number(position ?? 0));
    session.playback.updatedAt = Date.now();
    addEvent(session, `Seeked to ${Math.round(session.playback.position)}s`);
    saveWatchStateToDisk();
    return session;
  }

  if (action === 'next') {
    session.current = session.queue.shift() || null;
    if (session.current) maybePrepareSharedHls(session.current.item);
    session.playback = { status: session.current ? 'paused' : 'idle', position: 0, updatedAt: Date.now() };
    addEvent(session, session.current ? `Loaded ${session.current.item.title}` : 'Queue ended');
    saveWatchStateToDisk();
    return session;
  }

  if (action === 'jump') {
    const index = Number.isFinite(targetIndex) ? Math.floor(Number(targetIndex)) : -1;
    if (index < 0 || index >= session.queue.length) throw new Error('Queue item is no longer available');
    const [request] = session.queue.splice(index, 1);
    session.queue = session.queue.slice(index);
    session.current = request;
    maybePrepareSharedHls(request.item);
    session.playback = { status: 'paused', position: 0, updatedAt: Date.now() };
    addEvent(session, `Loaded ${request.item.title}`);
    saveWatchStateToDisk();
    return session;
  }

  if (action === 'clear') {
    session.queue = [];
    session.current = null;
    session.playback = { status: 'idle', position: 0, updatedAt: Date.now() };
    addEvent(session, 'Cleared queue');
    saveWatchStateToDisk();
    return session;
  }

  throw new Error('Unsupported watch control action');
}

export async function handleWatchRequestCommand(params: {
  message: string;
  discordUserId: string;
  discordUserName: string;
  guildId: string;
  channelId: string;
  userMessageId?: string;
  publicBaseUrl?: string;
  // eslint-disable-next-line no-unused-vars
  reply?: (content: string) => void | Promise<void>;
}) {
  const reply = params.reply || ((content: string) => sendDiscordReply(params.channelId, content, params.userMessageId));

  if (parseWatchAcceptCommand(params.message)) {
    const sessionId = getWatchSessionId(params.guildId, params.channelId);
    const accepted = acceptWatchRecommendation({
      sessionId,
      guildId: params.guildId,
      channelId: params.channelId,
      userId: params.discordUserId,
      username: params.discordUserName,
    });

    if ('error' in accepted) {
      await reply('No pending Internet Archive recommendation. Search with !wr first.');
      return true;
    }

    await reply(`Added "${accepted.request.item.title}" from Internet Archive. Watch room: ${getWatchRoomUrl(sessionId, params.publicBaseUrl)}`);
    return true;
  }

  const parsed = parseWatchCommand(params.message);
  if (!parsed) return false;

  if (!parsed.query) {
    await reply(`Usage: ${parsed.command} <movie, show, or test stream>`);
    return true;
  }

  const sessionId = getWatchSessionId(params.guildId, params.channelId);
  const result = await requestWatchItem({
    sessionId,
    guildId: params.guildId,
    channelId: params.channelId,
    query: parsed.query,
    userId: params.discordUserId,
    username: params.discordUserName,
  });

  if ('error' in result) {
    if (result.discovery) {
      await reply(`No playable Xtream/VOD match found. Watchmode found "${result.discovery.title}" (${result.discovery.year}) as a likely title, but Watchmode only provides discovery links/metadata, not a stream. Try a provider title, or search again for a public-domain fallback.`);
      return true;
    }

    if (result.recommendation) {
      await reply(`No playable Xtream VOD/live match found. Internet Archive returned best title comparison: "${result.recommendation.title}". Type !add to accept this recommendation.`);
      return true;
    }

    await reply(`No match found for "${parsed.query}". Try "big buck bunny", "sintel", "tears of steel", or "hls".`);
    return true;
  }

  const position = result.session.current?.requestId === result.request.requestId
    ? 'now playing'
    : `queue position ${result.session.queue.length}`;
  const activityInviteUrl = await createDiscordActivityInvite(params.channelId);
  const joinUrl = activityInviteUrl || getActivityUrl(params.publicBaseUrl);

  await reply(`Added "${result.request.item.title}" (${position}). Join the Activity: ${joinUrl}`);

  return true;
}
