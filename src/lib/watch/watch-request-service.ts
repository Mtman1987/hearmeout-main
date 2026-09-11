import {
  findXtreamCatalogItemById,
  findXtreamSeriesEpisode,
  getNextXtreamSeriesEpisode,
  isXtreamConfigured,
  isXtreamMockEnabled,
  searchXtreamCatalog,
  searchXtreamCatalogRanked,
} from './xtream-provider';
import { findInternetArchiveRecommendation } from './internet-archive-provider';
import { findWatchmodeRecommendation } from './watchmode-provider';
import { autoRadioNext, getRoomState, rememberAutoRadioTrack, resolveSongRequest, setAutoRadioEnabled } from '@/lib/bot-actions';
import { DISCORD_CLIENT_ID } from '@/lib/public-config';
import { ACTIVITY_ROOM_ID, getGlobalWatchSessionId, getMusicWatchSessionId, getScopedWatchSessionId, normalizeWatchSessionAlias, type WatchMediaKind } from '@/lib/watch-session';
import { publishSpmtEvent } from '@/lib/spmt-client';
import {
  sendHearMeOutDiscordMessage,
  type HearMeOutDiscordContext,
  type HearMeOutDiscordPayload as DiscordMessagePayload,
} from '@/lib/discord-messaging';
import type { PlaylistItem } from '@/types/playlist';
import { dirname } from 'path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';

type WatchCatalogItem = {
  id: string;
  type: 'movie' | 'live' | 'music' | 'tts';
  title: string;
  year: number;
  runtime: string;
  source: string;
  poster: string;
  playbackUrl: string;
  overview: string;
  metadata?: {
    provider?: 'xtream' | 'youtube' | 'youtube-video' | 'tts' | 'offline';
    kind?: 'series-episode' | 'song' | 'tts';
    seriesId?: string;
    seriesTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    episodeId?: string;
    episodeExtension?: string;
    episodeTitle?: string;
    videoId?: string;
    artist?: string;
    originalUrl?: string;
    audioPlaybackUrl?: string;
    videoPlaybackUrl?: string;
    embedPlaybackUrl?: string;
    playbackMode?: 'audio' | 'video';
    playbackStrategy?: 'proxy' | 'embed' | 'offline';
  };
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

type WatchSessionMetadata = {
  scopeType: 'legacy' | 'room' | 'discord';
  roomId?: string;
  guildId?: string;
  channelId?: string;
  mediaKind: WatchMediaKind;
  createdAt: number;
  lastActiveAt: number;
};

type WatchSession = {
  id: string;
  guildId: string;
  channelId: string;
  metadata?: WatchSessionMetadata;
  queue: WatchRequest[];
  ttsQueue?: WatchRequest[];
  current: WatchRequest | null;
  autoRadio?: boolean;
  playback: {
    status: 'idle' | 'paused' | 'playing';
    position: number;
    updatedAt: number;
    muted?: boolean;
    volume?: number;
  };
  events: Array<{
    id: string;
    at: string;
    message: string;
  }>;
};

type SeriesProgress = {
  provider: 'xtream';
  seriesId: string;
  seriesTitle: string;
  nextSeasonNumber: number;
  nextEpisodeNumber: number;
  updatedAt: number;
};

type WatchControlActor = {
  actorUserId?: string;
  roomId?: string;
  guildId?: string;
  channelId?: string;
  isHost?: boolean;
  isAdmin?: boolean;
  platform?: 'room' | 'discord' | 'activity' | 'web' | 'admin' | 'twitch';
  expectedRequestId?: string;
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
const retiredSessions = new Map<string, WatchSession>();
let lastLoadedStateContent = '';
globalThis.__watchRequestSessions = sessions;
const pendingRecommendations = new Map<string, WatchCatalogItem>();
const seriesProgress = new Map<string, SeriesProgress>();
const WATCH_STATE_FILE = process.env.WATCH_STATE_FILE || (process.env.FLY_APP_NAME ? '/data/watch-state.json' : './data/watch-state.json');
const WATCH_STATE_BACKUP_FILE = `${WATCH_STATE_FILE}.bak`;
let lastLoadedStateMtime = 0;

function ensureWatchStateDir() {
  const dir = dirname(WATCH_STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadWatchStateFromDisk() {
  const candidates = [WATCH_STATE_FILE, WATCH_STATE_BACKUP_FILE];
  for (const stateFile of candidates) {
    try {
      if (!existsSync(stateFile)) continue;
      const raw = readFileSync(stateFile);
      const mtime = statSync(stateFile).mtimeMs;
    if (raw.toString('utf8') === lastLoadedStateContent) return;
    lastLoadedStateContent = raw.toString('utf8');
    const payload = JSON.parse(raw.toString('utf8')) as {
      sessions?: Array<[string, WatchSession]>;
      retiredSessions?: Array<[string, WatchSession]>;
      pendingRecommendations?: Array<[string, WatchCatalogItem]>;
      seriesProgress?: Array<[string, SeriesProgress]>;
    };
    sessions.clear();
    for (const [id, session] of payload.sessions || []) {
      if (id === getGlobalWatchSessionId() || id === getMusicWatchSessionId()) sessions.set(id, session);
      else retiredSessions.set(id, session);
    }
    for (const [id, session] of payload.retiredSessions || []) retiredSessions.set(id, session);
    pendingRecommendations.clear();
    for (const [key, item] of payload.pendingRecommendations || []) pendingRecommendations.set(key, item);
    seriesProgress.clear();
    for (const [key, progress] of payload.seriesProgress || []) seriesProgress.set(key, progress);
    lastLoadedStateMtime = mtime || Date.now();
      if (stateFile === WATCH_STATE_BACKUP_FILE) {
        console.warn('[WatchRequest] Loaded last-known-good watch state backup.');
      }
      return;
    } catch (error) {
      console.error(`[WatchRequest] Failed to load watch state from ${stateFile}:`, error);
    }
  }
}

function saveWatchStateToDisk() {
  try {
    ensureWatchStateDir();
    const tempFile = `${WATCH_STATE_FILE}.${process.pid}.tmp`;
    const payload = JSON.stringify({
      sessions: Array.from(sessions.entries()),
      retiredSessions: Array.from(retiredSessions.entries()),
      pendingRecommendations: Array.from(pendingRecommendations.entries()),
      seriesProgress: Array.from(seriesProgress.entries()),
    }, null, 2);
    writeFileSync(tempFile, payload, 'utf8');
    lastLoadedStateContent = payload;
    if (existsSync(WATCH_STATE_FILE)) copyFileSync(WATCH_STATE_FILE, WATCH_STATE_BACKUP_FILE);
    renameSync(tempFile, WATCH_STATE_FILE);
    lastLoadedStateMtime = statSync(WATCH_STATE_FILE).mtimeMs;
  } catch (error) {
    console.error('[WatchRequest] Failed to save watch state:', error);
    const tempFile = `${WATCH_STATE_FILE}.${process.pid}.tmp`;
    if (existsSync(tempFile)) {
      try { unlinkSync(tempFile); } catch {}
    }
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
  if (item.type === 'music' || item.type === 'tts') return playbackUrl;
  const xtreamMatch = playbackUrl.match(/^\/activity-provider\/xtream\/(vod|series)\/(\d+)$/i);
  const episodeMatch = playbackUrl.match(/^\/activity-provider\/xtream\/episode\/(\d+-[a-z0-9]+)$/i);
  if (episodeMatch) return `/api/watch/xtream/hls/episode-${episodeMatch[1].toLowerCase()}/index.m3u8`;
  if (xtreamMatch) return `/api/watch/xtream/hls/${xtreamMatch[1].toLowerCase()}-${xtreamMatch[2]}/index.m3u8`;
  if (playbackUrl.startsWith('/')) return playbackUrl;
  return `/activity-proxy?url=${encodeURIComponent(playbackUrl)}`;
}

function getYoutubeMusicVideoId(item: WatchCatalogItem) {
  const metadataId = item.metadata?.videoId;
  if (metadataId && /^[A-Za-z0-9_-]{11}$/.test(metadataId)) return metadataId;
  const itemIdMatch = item.id.match(/^youtube-([A-Za-z0-9_-]{11})$/);
  if (itemIdMatch) return itemIdMatch[1];
  try {
    const parsed = new URL(item.playbackUrl, 'https://hearmeout.local');
    const videoId = parsed.searchParams.get('videoId') || parsed.searchParams.get('v');
    return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
}

function getYoutubeHlsUrl(videoId: string) {
  return `/api/watch/youtube/hls/${encodeURIComponent(videoId)}/index.m3u8`;
}

function getYoutubeEmbedUrl(videoId: string) {
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
}

function getPublicWatchItem(item: WatchCatalogItem): WatchCatalogItem {
  if (item.type !== 'music') {
    return {
      ...item,
      playbackUrl: getPublicPlaybackUrl(item),
    };
  }

  const videoId = getYoutubeMusicVideoId(item);
  if (!videoId) {
    return {
      ...item,
      playbackUrl: getPublicPlaybackUrl(item),
    };
  }

  const videoPlaybackUrl = getYoutubeHlsUrl(videoId);
  const embedPlaybackUrl = getYoutubeEmbedUrl(videoId);
  return {
    ...item,
    source: item.source.replace(/^YouTube Video/i, 'YouTube Music'),
    playbackUrl: videoPlaybackUrl,
    metadata: {
      ...(item.metadata || {}),
      provider: 'youtube',
      kind: 'song',
      videoId,
      audioPlaybackUrl: undefined,
      videoPlaybackUrl,
      embedPlaybackUrl,
      playbackMode: 'video',
      playbackStrategy: 'proxy',
    },
  };
}

function getPublicWatchRequest(request: WatchRequest) {
  if (request.item.type === 'tts') return { ...request, item: getPublicWatchItem(request.item) };
  const kind = request.item.type === 'music' ? 'music' : 'movie';
  const playbackUrl = `/api/watch/stream/${kind}/index.m3u8?requestId=${encodeURIComponent(request.requestId)}`;
  return {
    ...request,
    item: {
      ...request.item,
      playbackUrl,
      metadata: {
        ...request.item.metadata,
        originalUrl: undefined,
        embedPlaybackUrl: undefined,
        audioPlaybackUrl: playbackUrl,
        videoPlaybackUrl: playbackUrl,
        playbackStrategy: 'proxy' as const,
      },
    },
  };
}

function sendDiscordReply(channelId: string, content: string, userMessageId?: string): void {
  if (!channelId) return;
  sendHearMeOutDiscordMessage(channelId, content, {
    responseType: 'Watch Request',
    sourceMessageId: userMessageId,
    sourceMessage: 'Watch request',
  }).catch((error) => console.error('[WatchRequest] Discord reply failed:', error));
}

async function sendDiscordPayload(channelId: string, payload: DiscordMessagePayload, context: HearMeOutDiscordContext = {}) {
  if (!channelId || channelId === 'watch') return { ok: false, skipped: 'missing-discord-channel' };
  return sendHearMeOutDiscordMessage(channelId, payload, context);
}

function sessionIdFromJoinUrl(joinUrl?: string) {
  if (!joinUrl) return getGlobalWatchSessionId();
  try {
    const url = new URL(joinUrl);
    return normalizeWatchSessionAlias(url.searchParams.get('sessionId'), getGlobalWatchSessionId());
  } catch {
    return getGlobalWatchSessionId();
  }
}

function getActivityJoinUrl(preferredBaseUrl: string | undefined, sessionId: string) {
  return getActivityUrl(preferredBaseUrl, sessionId);
}

export function watchControlComponents(joinUrl?: string, sessionId = sessionIdFromJoinUrl(joinUrl)) {
  return [{ type: 1, components: [{ type: 2, style: 5, label: 'Open player', url: joinUrl || getActivityUrl(undefined, sessionId) }] }];
}

export function watchControlsPromptComponents(joinUrl?: string, sessionId = sessionIdFromJoinUrl(joinUrl)) {
  return [{ type: 1, components: [{ type: 2, style: 5, label: 'Open player', url: joinUrl || getActivityUrl(undefined, sessionId) }] }];
}

export async function getWatchActivityJoinUrl(params: {
  publicBaseUrl?: string;
  sessionId: string;
  activityVoiceChannelId?: string;
  fallbackChannelId?: string;
}) {
  const activityInviteUrl = await createDiscordActivityInvite(params.activityVoiceChannelId);
  return activityInviteUrl || getActivityUrl(params.publicBaseUrl, params.sessionId);
}

export function watchLaneComponents() {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 5, label: 'Movies', url: getActivityUrl(undefined, getGlobalWatchSessionId()) },
        { type: 2, style: 5, label: 'Music', url: getActivityUrl(undefined, getMusicWatchSessionId()) },
      ],
    },
  ];
}

export function watchVolumeComponents(sessionId = getGlobalWatchSessionId()) {
  return [{ type: 1, components: [{ type: 2, style: 5, label: 'Open player', url: getActivityUrl(undefined, sessionId) }] }];
}

export function buildWatchJoinMessage(title: string, position: string, joinUrl: string, item?: WatchCatalogItem, sessionId = sessionIdFromJoinUrl(joinUrl)): DiscordMessagePayload {
  const fields = [
    { name: 'Status', value: position, inline: true },
    { name: 'Source', value: item?.source || 'Watch room', inline: true },
  ];
  if (item?.runtime) fields.push({ name: 'Runtime', value: item.runtime, inline: true });

  return {
    content: '',
    embeds: [{
      title,
      description: `[Join the Discord Activity](${joinUrl})`,
      color: 0x22c55e,
      fields,
      thumbnail: item?.poster ? { url: item.poster } : undefined,
      footer: { text: 'Open the player to watch and adjust your own volume.' },
    }],
    components: watchControlsPromptComponents(joinUrl, sessionId),
    allowed_mentions: { parse: [] },
  };
}

function addEvent(session: WatchSession, message: string) {
  session.events.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    message,
  });
  session.events = session.events.slice(0, 30);
}

function getEffectivePlaybackPosition(session: WatchSession, now = Date.now()) {
  const basePosition = Number(session.playback.position || 0);
  if (session.playback.status !== 'playing') return basePosition;
  return Math.max(0, basePosition + (now - Number(session.playback.updatedAt || now)) / 1000);
}

function inferSessionMetadata(id: string, guildId = 'local', channelId = 'watch', mediaKind: WatchMediaKind = 'movie'): WatchSessionMetadata {
  const now = Date.now();
  const roomMatch = id.match(/^watch-room-(.+)-(movie|music)$/);
  const discordMatch = id.match(/^watch-discord-([a-z0-9_]+)-([a-z0-9_]+)-(movie|music)$/);
  if (roomMatch) {
    return { scopeType: 'room', roomId: roomMatch[1], mediaKind: roomMatch[2] as WatchMediaKind, createdAt: now, lastActiveAt: now };
  }
  if (discordMatch) {
    return {
      scopeType: 'discord',
      guildId: guildId && guildId !== 'local' ? guildId : discordMatch[1],
      channelId: channelId && channelId !== 'watch' ? channelId : discordMatch[2],
      mediaKind: discordMatch[3] as WatchMediaKind,
      createdAt: now,
      lastActiveAt: now,
    };
  }
  return {
    scopeType: 'legacy',
    guildId,
    channelId,
    mediaKind: id === getMusicWatchSessionId() ? 'music' : mediaKind,
    createdAt: now,
    lastActiveAt: now,
  };
}

function touchSession(session: WatchSession) {
  const metadata = session.metadata || inferSessionMetadata(session.id, session.guildId, session.channelId);
  session.metadata = metadata;
  metadata.lastActiveAt = Date.now();
}

function createSession(id: string, guildId = 'local', channelId = 'watch', mediaKind: WatchMediaKind = 'movie'): WatchSession {
  const session: WatchSession = {
    id,
    guildId,
    channelId,
    metadata: inferSessionMetadata(id, guildId, channelId, mediaKind),
    queue: [],
    ttsQueue: [],
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
  touchSession(session);
  const request: WatchRequest = {
    requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    requestedBy,
    addedAt: new Date().toISOString(),
    item,
  };

  if (!session.current) {
    session.current = request;
    session.playback = { status: 'playing', position: 0, updatedAt: Date.now() };
    addEvent(session, `${requestedBy.username} loaded ${item.title}`);
  } else {
    session.queue.push(request);
    addEvent(session, `${requestedBy.username} queued ${item.title}`);
  }

  saveWatchStateToDisk();
  return request;
}

function publishWatchQueueEvent(kind: 'movie' | 'music' | 'tts', session: WatchSession, request: WatchRequest) {
  void publishSpmtEvent({
    type: `media.${kind}.queued`,
    visibility: 'creator',
    actor: {
      userId: request.requestedBy.userId,
      username: request.requestedBy.username,
      displayName: request.requestedBy.username,
    },
    payload: {
      summary: `${request.requestedBy.username} queued ${request.item.title} in HearMeOut.`,
      mediaKind: kind,
      sessionId: session.id,
      guildId: session.guildId,
      channelId: session.channelId,
      requestId: request.requestId,
      title: request.item.title,
      source: request.item.source,
      provider: request.item.metadata?.provider,
      queueLength: session.queue.length,
      isNowPlaying: session.current?.requestId === request.requestId,
    },
  });
}

function formatDurationMs(durationMs: number | undefined) {
  const totalSeconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
  if (!totalSeconds) return 'unknown';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function musicTrackToWatchItem(track: PlaylistItem): WatchCatalogItem {
  if (track.source === 'offline' && track.playbackUrl) {
    return {
      id: `offline-${track.id}`,
      type: 'music',
      title: track.title,
      year: new Date().getFullYear(),
      runtime: formatDurationMs(track.duration),
      source: track.artist ? `Offline Music: ${track.artist}` : 'Offline Music Library',
      poster: track.thumbnail || '',
      playbackUrl: track.playbackUrl,
      overview: `Offline backup song request from ${track.addedBy || 'unknown user'}.`,
      metadata: {
        provider: 'offline',
        kind: 'song',
        artist: track.artist,
        originalUrl: track.url,
        audioPlaybackUrl: track.playbackUrl,
        playbackMode: 'audio',
        playbackStrategy: 'offline',
      },
    };
  }

  const videoPlaybackUrl = getYoutubeHlsUrl(track.id);
  return {
    id: `youtube-${track.id}`,
    type: 'music',
    title: track.title,
    year: new Date().getFullYear(),
    runtime: formatDurationMs(track.duration),
    source: track.artist ? `YouTube Music: ${track.artist}` : 'YouTube Music',
    poster: track.thumbnail || '',
    playbackUrl: videoPlaybackUrl,
    overview: `Song request from ${track.addedBy || 'unknown user'}.`,
    metadata: {
      provider: 'youtube',
      kind: 'song',
      videoId: track.id,
      artist: track.artist,
      originalUrl: track.url,
      videoPlaybackUrl,
      playbackMode: 'video',
      playbackStrategy: 'proxy',
    },
  };
}

function isPlayableClientUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (raw.startsWith('/')) return true;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function ttsToWatchItem(params: { audioUrl: string; text?: string; title?: string; botName?: string }): WatchCatalogItem {
  const label = params.title || (params.text ? `${params.botName || 'Athena'}: ${params.text.slice(0, 80)}` : `${params.botName || 'Bot'} TTS`);
  return {
    id: `tts-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: 'tts',
    title: label,
    year: new Date().getFullYear(),
    runtime: 'speech',
    source: params.botName || 'Bot TTS',
    poster: '',
    playbackUrl: params.audioUrl,
    overview: params.text || 'Queued bot speech.',
    metadata: {
      provider: 'tts',
      kind: 'tts',
    },
  };
}

export function parseWatchCommand(message: string) {
  const trimmed = message.trim();
  const match = trimmed.match(/^!(wr|watch)(?:\s+(.+))?$/i);
  if (!match) return null;
  const extracted = extractWatchRoomAlias((match[2] || '').trim());
  return {
    command: `!${match[1].toLowerCase()}`,
    query: extracted.query,
    sessionId: extracted.sessionId,
  };
}

export function extractWatchRoomAlias(query: string, fallbackSessionId?: string) {
  let nextQuery = String(query || '').trim();
  let roomAlias = '';
  nextQuery = nextQuery.replace(/\s+--(?:room|tab|session)\s+("[^"]+"|'[^']+'|[^\s]+)\s*$/i, (_match, value) => {
    roomAlias = String(value || '').replace(/^["']|["']$/g, '').trim();
    return '';
  }).trim();
  return {
    query: nextQuery,
    sessionId: normalizeWatchSessionAlias(roomAlias, fallbackSessionId || getGlobalWatchSessionId()),
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

export async function searchWatchProviderOptions(query: string | null | undefined) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) return [];
  const ranked = await searchXtreamCatalogRanked(normalizedQuery).catch((error) => {
    console.error('[WatchRequest] Ranked Xtream search failed:', error);
    return [];
  });
  if (ranked.length) {
    return ranked.slice(0, 24).map((entry, index) => ({
      ...entry.item,
      rank: index + 1,
      score: entry.score,
      matchReasons: entry.reasons,
      recommended: index === 0,
      selectable: true,
      audio: {
        multiTrack: entry.item.metadata?.multiAudio === true,
        languages: entry.item.metadata?.languages || [],
      },
      quality: entry.item.metadata?.quality || null,
      container: entry.item.metadata?.containerExtension || null,
    }));
  }

  return searchWatchCatalog(normalizedQuery).slice(0, 12).map((item, index) => ({
    ...item,
    rank: index + 1,
    score: 50 - index,
    matchReasons: ['public test catalog'],
    recommended: index === 0,
    selectable: true,
    audio: { multiTrack: false, languages: [] as string[] },
    quality: null,
    container: item.playbackUrl.split('?')[0].split('.').at(-1) || null,
  }));
}

function progressKey(userId: string, seriesId: string) {
  return `${userId || 'discord'}:xtream:${seriesId}`;
}

function getProgressForUser(userId: string, seriesId: string) {
  const progress = seriesProgress.get(progressKey(userId, seriesId));
  if (!progress) return undefined;
  return {
    seasonNumber: progress.nextSeasonNumber,
    episodeNumber: progress.nextEpisodeNumber,
  };
}

async function updateSeriesProgress(userId: string, item: WatchCatalogItem) {
  const metadata = item.metadata;
  if (metadata?.provider !== 'xtream' || metadata.kind !== 'series-episode' || !metadata.seriesId) return;
  const seasonNumber = Number(metadata.seasonNumber || 1);
  const episodeNumber = Number(metadata.episodeNumber || 1);
  const next = await getNextXtreamSeriesEpisode(metadata.seriesId, seasonNumber, episodeNumber, metadata.seriesTitle).catch(() => null);
  const nextMetadata = next?.metadata;
  seriesProgress.set(progressKey(userId, metadata.seriesId), {
    provider: 'xtream',
    seriesId: metadata.seriesId,
    seriesTitle: metadata.seriesTitle || item.title,
    nextSeasonNumber: Number(nextMetadata?.seasonNumber || seasonNumber),
    nextEpisodeNumber: Number(nextMetadata?.episodeNumber || episodeNumber + 1),
    updatedAt: Date.now(),
  });
}

export function getWatchCatalogItem(id: string | null | undefined) {
  return TEST_CATALOG.find((item) => item.id === id) || null;
}

export function getWatchSession(sessionId: string, guildId?: string, channelId?: string, mediaKind: WatchMediaKind = 'movie') {
  loadWatchStateFromDisk();
  const legacyFallback = mediaKind === 'music' ? getMusicWatchSessionId() : getGlobalWatchSessionId();
  const normalizedSessionId = normalizeWatchSessionAlias(sessionId, legacyFallback);
  const resolvedSessionId = normalizedSessionId;
  const session = sessions.get(resolvedSessionId) || createSession(resolvedSessionId, guildId, channelId, mediaKind);
  if (!session.metadata) session.metadata = inferSessionMetadata(resolvedSessionId, guildId, channelId, mediaKind);
  const metadata = session.metadata;
  const hasRealGuild = Boolean(guildId && guildId !== 'local');
  const hasRealChannel = Boolean(channelId && channelId !== 'watch');
  if ((metadata.scopeType === 'legacy' || metadata.scopeType === 'discord') && (hasRealGuild || hasRealChannel)) {
    if (hasRealGuild) {
      session.guildId = guildId!;
      metadata.guildId = guildId!;
    }
    if (hasRealChannel) {
      session.channelId = channelId!;
      metadata.channelId = channelId!;
    }
  }
  return session;
}

export async function announceWatchRequestToDiscord(params: {
  session: WatchSession;
  request: WatchRequest;
  publicBaseUrl?: string;
  activityVoiceChannelId?: string;
}) {
  const metadata = params.session.metadata || inferSessionMetadata(params.session.id, params.session.guildId, params.session.channelId);
  const channelId = metadata.channelId && metadata.channelId !== 'watch' ? metadata.channelId : params.session.channelId;
  if (!channelId || channelId === 'watch') return { ok: false, skipped: 'missing-discord-channel' };
  const position = params.session.current?.requestId === params.request.requestId
    ? 'now playing'
    : `queue position ${params.session.queue.length}`;
  const joinUrl = await getWatchActivityJoinUrl({
    publicBaseUrl: params.publicBaseUrl,
    sessionId: params.session.id,
    activityVoiceChannelId: params.activityVoiceChannelId,
    fallbackChannelId: channelId,
  });
  return sendDiscordPayload(
    channelId,
    buildWatchJoinMessage(params.request.item.title, position, joinUrl, params.request.item, params.session.id),
    {
      responseType: 'Watch Party Update',
      sourceUser: params.request.requestedBy.username,
      sourceMessage: `Requested ${params.request.item.title}`,
    },
  );
}

async function createDiscordActivityInvite(channelId?: string) {
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
      if (response.status === 404 && payload?.code === 10003) {
        console.log('[WatchRequest] Discord voice channel unavailable; using the normal Activity URL.');
      } else {
        console.warn('[WatchRequest] Discord activity invite failed:', response.status, payload);
      }
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

export function getWatchSessionId(guildId: string, channelId: string, kind: WatchMediaKind = 'movie') {
  return getScopedWatchSessionId(guildId, channelId, kind);
}

export function getWatchRoomUrl(sessionId: string, preferredBaseUrl?: string) {
  return `${getPublicBaseUrl(preferredBaseUrl)}/watch/${sessionId}`;
}

export function getActivityUrl(preferredBaseUrl?: string, sessionId?: string) {
  const url = new URL(`${getPublicBaseUrl(preferredBaseUrl)}/activity`);
  if (sessionId) url.searchParams.set('sessionId', sessionId);
  return url.toString();
}

export function getDefaultActivitySessionId(rawSessionId?: string | null) {
  if (rawSessionId) return normalizeWatchSessionAlias(rawSessionId, getGlobalWatchSessionId());

  const movieSession = getResolvedWatchSession(getGlobalWatchSessionId());
  const musicSession = getResolvedWatchSession(getMusicWatchSessionId());
  if (!movieSession.current && musicSession.current) return getMusicWatchSessionId();
  if (movieSession.current && !musicSession.current) return getGlobalWatchSessionId();
  if (movieSession.current && musicSession.current) {
    const movieActiveAt = Math.max(Number(movieSession.metadata?.lastActiveAt || 0), Number(movieSession.playback.updatedAt || 0));
    const musicActiveAt = Math.max(Number(musicSession.metadata?.lastActiveAt || 0), Number(musicSession.playback.updatedAt || 0));
    return musicActiveAt > movieActiveAt ? getMusicWatchSessionId() : getGlobalWatchSessionId();
  }
  return getGlobalWatchSessionId();
}

export function getPublicWatchSession(session: WatchSession, preferredBaseUrl?: string) {
  return {
    ...session,
    playback: { status: session.playback.status, position: session.playback.position, updatedAt: session.playback.updatedAt },
    queue: session.queue.map(getPublicWatchRequest),
    ttsQueue: (session.ttsQueue || []).map(getPublicWatchRequest),
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
  loadWatchStateFromDisk();
  const explicitEpisode = await findXtreamSeriesEpisode(params.query, (seriesId) => getProgressForUser(params.userId, seriesId)).catch((error) => {
    console.error('[WatchRequest] Xtream episode lookup failed:', error);
    return null;
  });
  const selectedProviderItem = params.itemId
    ? await findXtreamCatalogItemById(params.itemId).catch((error) => {
        console.error('[WatchRequest] Exact provider item lookup failed:', error);
        return null;
      })
    : null;
  let item = getWatchCatalogItem(params.itemId) || selectedProviderItem || explicitEpisode || (await searchWatchProviders(params.query))[0];
  if (item?.id.startsWith('xtream-series-') && !item.metadata) {
    const seriesTitle = item.title.replace(/\s+-\s+first episode$/i, '');
    item = await findXtreamSeriesEpisode(`${seriesTitle} episode 1`).catch(() => null) || item;
  }
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
      pendingRecommendations.set(`${normalizeWatchSessionAlias(params.sessionId)}:${params.userId}`, recommendation);
      saveWatchStateToDisk();
      return { error: 'No matching provider item' as const, recommendation };
    }
    return {
      error: isXtreamConfigured()
        ? `No playable provider match found for "${params.query || ''}"`
        : 'No matching catalog item',
    } as const;
  }

  const session = getWatchSession(getGlobalWatchSessionId(), params.guildId, params.channelId, 'movie');
  const request = enqueue(session, item, {
    userId: params.userId,
    username: params.username,
  });
  if (session.current?.requestId === request.requestId) maybePrepareSharedHls(item);
  await updateSeriesProgress(params.userId, item);
  saveWatchStateToDisk();
  publishWatchQueueEvent('movie', session, request);

  return { request, session };
}

export async function requestWatchMusicItem(params: {
  sessionId: string;
  guildId?: string;
  channelId?: string;
  query?: string;
  userId: string;
  username: string;
  platform?: 'discord' | 'twitch' | 'admin' | 'activity' | 'web';
}) {
  loadWatchStateFromDisk();
  const query = String(params.query || '').trim();
  if (!query) return { error: 'No matching music item' as const, result: { success: false, message: 'Missing song query.' } };

  const resolved = await resolveSongRequest(query, `${params.username} (${params.platform || 'watch'})`);
  if (!resolved.success || !resolved.track) {
    return { error: 'No matching music item' as const, result: resolved };
  }

  const item = musicTrackToWatchItem(resolved.track);
  await rememberAutoRadioTrack(ACTIVITY_ROOM_ID, resolved.track, params.userId);
  const roomState = await getRoomState(ACTIVITY_ROOM_ID);
  const session = getWatchSession(getMusicWatchSessionId(), params.guildId, params.channelId, 'music');
  session.autoRadio = roomState?.autoRadio === true;
  const request = enqueue(session, item, {
    userId: params.userId,
    username: params.username,
  });
  if (session.current?.requestId === request.requestId) maybePrepareSharedHls(item);
  saveWatchStateToDisk();
  publishWatchQueueEvent('music', session, request);

  return {
    result: { success: true, message: `Queued up: "${item.title}"` },
    request,
    session,
  };
}

export async function requestWatchTtsItem(params: {
  sessionId: string;
  guildId?: string;
  channelId?: string;
  audioUrl?: string;
  text?: string;
  title?: string;
  botName?: string;
  userId: string;
  username: string;
}) {
  loadWatchStateFromDisk();
  if (!isPlayableClientUrl(params.audioUrl)) {
    return { error: 'No matching TTS item' as const, result: { success: false, message: 'Missing or invalid TTS audio URL.' } };
  }

  const item = ttsToWatchItem({
    audioUrl: String(params.audioUrl),
    text: params.text,
    title: params.title,
    botName: params.botName,
  });
  const session = getWatchSession(getMusicWatchSessionId(), params.guildId, params.channelId, 'music');
  touchSession(session);
  const request: WatchRequest = {
    requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    requestedBy: {
      userId: params.userId,
      username: params.username,
    },
    addedAt: new Date().toISOString(),
    item,
  };
  session.ttsQueue = [...(session.ttsQueue || []), request].slice(-20);
  addEvent(session, `${params.username} sent TTS: ${item.title}`);
  saveWatchStateToDisk();
  publishWatchQueueEvent('tts', session, request);

  return {
    result: { success: true, message: `Queued speech overlay: "${item.title}"` },
    request,
    session,
  };
}

export function acceptWatchRecommendation(params: {
  sessionId: string;
  guildId?: string;
  channelId?: string;
  userId: string;
  username: string;
}) {
  loadWatchStateFromDisk();
  const key = `${normalizeWatchSessionAlias(params.sessionId)}:${params.userId}`;
  const item = pendingRecommendations.get(key);
  if (!item) return { error: 'No pending recommendation' as const };

  pendingRecommendations.delete(key);
  const session = getWatchSession(getGlobalWatchSessionId(), params.guildId, params.channelId, 'movie');
  const request = enqueue(session, item, {
    userId: params.userId,
    username: params.username,
  });
  if (session.current?.requestId === request.requestId) maybePrepareSharedHls(item);
  updateSeriesProgress(params.userId, item).catch(() => {});
  saveWatchStateToDisk();

  return { request, session };
}

function maybePrepareSharedHls(item: WatchCatalogItem) {
  const kind = item.type === 'music' ? 'music' : 'movie';
  const session = getWatchSession(kind === 'music' ? getMusicWatchSessionId() : getGlobalWatchSessionId());
  if (!session.current) return;
  const requestId = session.current.requestId;
  void fetch(`${getPublicBaseUrl()}/api/watch/stream/${kind}/index.m3u8?requestId=${encodeURIComponent(requestId)}`).catch(() => {});
}

async function getAutoNextEpisodeRequest(session: WatchSession) {
  const current = session.current;
  const metadata = current?.item.metadata;
  const userId = current?.requestedBy.userId || 'discord';
  if (metadata?.provider !== 'xtream' || metadata.kind !== 'series-episode' || !metadata.seriesId) return null;
  const next = await getNextXtreamSeriesEpisode(
    metadata.seriesId,
    Number(metadata.seasonNumber || 1),
    Number(metadata.episodeNumber || 1),
    metadata.seriesTitle,
  ).catch(() => null);
  if (!next) return null;
  await updateSeriesProgress(userId, next);
  return {
    requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    requestedBy: current!.requestedBy,
    addedAt: new Date().toISOString(),
    item: next,
  };
}

async function getAutoRadioRequest(sessionId: string): Promise<WatchRequest | null> {
  if (sessionId !== getMusicWatchSessionId()) return null;
  const generated = await autoRadioNext(ACTIVITY_ROOM_ID);
  const roomState = generated.success ? await getRoomState(ACTIVITY_ROOM_ID) : null;
  if (!roomState?.currentTrack) return null;
  return {
    requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    requestedBy: { userId: 'auto-radio', username: 'Auto-Radio' },
    addedAt: new Date().toISOString(),
    item: musicTrackToWatchItem(roomState.currentTrack),
  };
}

export const PLAYBACK_CONTROLS_DISABLED = 'Playback controls are temporarily unavailable. Use the volume slider in your player; it only changes what you hear.';

export async function controlWatchSession(_sessionId: string, _action: string, _position?: number, _targetIndex?: number, _actor?: WatchControlActor): Promise<WatchSession> {
  throw new Error(PLAYBACK_CONTROLS_DISABLED);
}

declare global { var __hmoAdvanceLocks: Map<string, Promise<unknown>> | undefined; }
const advanceLocks = globalThis.__hmoAdvanceLocks ||= new Map<string, Promise<unknown>>();

// Only the authenticated shared producer calls this. Multiple viewers can
// never skip multiple songs, and late completion from an old source is inert.
export async function advanceSharedSource(kind: WatchMediaKind, expectedRequestId: string, failed = false) {
  const sessionId = kind === 'music' ? getMusicWatchSessionId() : getGlobalWatchSessionId();
  const previous = advanceLocks.get(sessionId) || Promise.resolve();
  const work = previous.catch(() => {}).then(async () => {
    const original = getWatchSession(sessionId);
    if (original.current?.requestId !== expectedRequestId) return original;
    const automatic = !original.queue.length && !failed
      ? await getAutoNextEpisodeRequest(original) || (original.autoRadio ? await getAutoRadioRequest(sessionId) : null)
      : null;
    // Re-read after async provider work so requests queued meanwhile survive.
    const session = getWatchSession(sessionId);
    if (session.current?.requestId !== expectedRequestId) return session;
    if (failed) addEvent(session, `Could not play ${session.current.item.title}`);
    session.current = session.queue.shift() || automatic;
    session.playback = { status: session.current ? 'playing' : 'idle', position: 0, updatedAt: Date.now() };
    touchSession(session);
    addEvent(session, session.current ? `Loaded ${session.current.item.title}` : 'Queue ended');
    saveWatchStateToDisk();
    if (session.current) maybePrepareSharedHls(session.current.item);
    return session;
  });
  advanceLocks.set(sessionId, work);
  try { return await work; }
  finally { if (advanceLocks.get(sessionId) === work) advanceLocks.delete(sessionId); }
}

export async function handleWatchRequestCommand(params: {
  message: string;
  discordUserId: string;
  discordUserName: string;
  guildId: string;
  channelId: string;
  roomId?: string;
  userMessageId?: string;
  publicBaseUrl?: string;
  activityVoiceChannelId?: string;
  // eslint-disable-next-line no-unused-vars
  reply?: (content: string) => void | Promise<void>;
  // eslint-disable-next-line no-unused-vars
  richReply?: (content: DiscordMessagePayload) => void | Promise<void>;
}) {
  const reply = params.reply || ((content: string) => sendDiscordReply(params.channelId, content, params.userMessageId));

  if (parseWatchAcceptCommand(params.message)) {
    const sessionId = getGlobalWatchSessionId();
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

  const defaultSessionId = getGlobalWatchSessionId();
  const sessionId = parsed.sessionId === getGlobalWatchSessionId()
    ? defaultSessionId
    : (parsed.sessionId || defaultSessionId);
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

    if (isXtreamConfigured()) {
      await reply(`No playable provider match found for "${parsed.query}". The Xtream provider is configured, but this title/episode did not match a playable catalog entry. Try the exact provider title, for example "rick and morty s01e01", or search just the show title.`);
      return true;
    }

    await reply(`No match found for "${parsed.query}". No watch provider is configured, so only demo streams are available. Try "big buck bunny", "sintel", "tears of steel", or "hls".`);
    return true;
  }

  const position = result.session.current?.requestId === result.request.requestId
    ? 'now playing'
    : `queue position ${result.session.queue.length}`;
  const joinUrl = await getWatchActivityJoinUrl({
    publicBaseUrl: params.publicBaseUrl,
    sessionId,
    activityVoiceChannelId: params.activityVoiceChannelId,
    fallbackChannelId: params.channelId,
  });

  if (params.richReply) {
    await params.richReply(buildWatchJoinMessage(result.request.item.title, position, joinUrl, result.request.item, result.session.id));
  } else {
    await reply(`Added "${result.request.item.title}" (${position}). Join the Activity: ${joinUrl}`);
  }

  return true;
}
