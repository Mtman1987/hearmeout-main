import type { ReadableStream } from 'node:stream/web';

export type XtreamKind = 'vod' | 'live' | 'series';

type XtreamStream = {
  stream_id?: number | string;
  series_id?: number | string;
  name?: string;
  title?: string;
  stream_icon?: string;
  cover?: string;
  container_extension?: string;
  stream_type?: string;
  year?: string;
  added?: string;
};

type M3uEntry = {
  title: string;
  url: string;
  group?: string;
  logo?: string;
};

type XtreamSeriesInfo = {
  episodes?: unknown;
};

type XtreamCatalogItem = {
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

let cachedStreams: { expiresAt: number; items: XtreamCatalogItem[] } | null = null;
const vodExtensions = new Map<string, string>();

const MOCK_CATALOG: XtreamCatalogItem[] = [
  {
    id: 'xtream-mock-bbb',
    type: 'movie',
    title: 'Xtream Mock: Big Buck Bunny',
    year: 2008,
    runtime: '10m',
    source: 'Xtream mock provider',
    poster: 'https://peach.blender.org/wp-content/uploads/title_anouncement.jpg',
    playbackUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    overview: 'Mock Xtream VOD result that exercises provider search and playback.',
  },
  {
    id: 'xtream-mock-sintel',
    type: 'movie',
    title: 'Xtream Mock: Sintel',
    year: 2010,
    runtime: '15m',
    source: 'Xtream mock provider',
    poster: 'https://durian.blender.org/wp-content/uploads/2010/05/sintel_poster.jpg',
    playbackUrl: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
    overview: 'Mock Xtream VOD result using a public HLS asset.',
  },
  {
    id: 'xtream-mock-live',
    type: 'live',
    title: 'Xtream Mock: Live HLS Channel',
    year: 2026,
    runtime: 'live',
    source: 'Xtream mock provider',
    poster: '',
    playbackUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    overview: 'Mock Xtream live channel for end-to-end Discord Activity testing.',
  },
];

function isMockEnabled() {
  return process.env.XTREAM_MOCK === 'true';
}

function isSeriesSearchEnabled() {
  return process.env.XTREAM_ENABLE_SERIES !== 'false';
}

function getPlaylistUrl() {
  return process.env.XTREAM_PLAYLIST_URL || process.env.M3U_PLAYLIST_URL || process.env.IPTV_PLAYLIST_URL || null;
}

function getConfig() {
  const baseUrl = process.env.XTREAM_BASE_URL?.replace(/\/$/, '');
  const username = process.env.XTREAM_USERNAME;
  const password = process.env.XTREAM_PASSWORD;
  if (!baseUrl || !username || !password) return null;
  return { baseUrl, username, password };
}

export function isXtreamConfigured() {
  return isMockEnabled() || Boolean(getConfig()) || Boolean(getPlaylistUrl());
}

export function isXtreamMockEnabled() {
  return isMockEnabled();
}

function playerApiUrl(action?: string) {
  const config = getConfig();
  if (!config) throw new Error('Xtream provider is not configured');
  const url = new URL('/player_api.php', config.baseUrl);
  url.searchParams.set('username', config.username);
  url.searchParams.set('password', config.password);
  if (action) url.searchParams.set('action', action);
  return url;
}

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function compact(value: unknown) {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function scoreItem(item: XtreamCatalogItem, query: string) {
  const needle = normalize(query);
  const compactNeedle = compact(query);
  const words = needle.split(/\s+/).filter((word) => word.length >= 3 && !['the', 'and'].includes(word));
  const titleIntentWords = words.filter((word) => !['show', 'series', 'season', 'episode', 'episodes'].includes(word) && !/^\d+$/.test(word));
  const title = normalize(item.title);
  const compactTitle = compact(item.title);
  const overview = normalize(item.overview);
  const isVod = item.id.startsWith('xtream-vod-');
  const isSeries = item.id.startsWith('xtream-series-');
  const isSeriesSearch = words.some((word) => ['show', 'series', 'season', 'episode', 'episodes'].includes(word)) || /\bs\d{1,2}\s*e\d{1,2}\b/i.test(needle);
  let score = 0;
  if (title === needle) score += 100;
  if (title.includes(needle)) score += 50;
  if (compactNeedle.length >= 3 && compactTitle === compactNeedle) score += 100;
  if (compactNeedle.length >= 3 && compactTitle.includes(compactNeedle)) score += 50;
  if (titleIntentWords.length >= 2 && titleIntentWords.every((word) => title.includes(word) || compactTitle.includes(compact(word)))) {
    score += 80;
  }
  for (const word of words) {
    if (title.includes(word)) score += 8;
    if (compactTitle.includes(compact(word))) score += 8;
    if (overview.includes(word)) score += 2;
  }
  if (score === 0) return 0;
  if (isSeriesSearch && isSeries) score += 60;
  if (isSeriesSearch && isVod) score -= 25;
  if (!isSeriesSearch && isVod) score += 25;
  if (overview.includes('(mp4)')) score += 12;
  if (overview.includes('(mkv)')) score -= 20;
  if (isSeries && !isSeriesSearch) score -= 30;
  return score;
}

function streamYear(stream: XtreamStream) {
  const parsed = Number(stream.year);
  if (Number.isFinite(parsed) && parsed > 1900) return parsed;
  return new Date().getFullYear();
}

function toCatalogItem(stream: XtreamStream, kind: XtreamKind): XtreamCatalogItem | null {
  const streamId = kind === 'series' ? stream.series_id : stream.stream_id;
  const title = stream.name || stream.title;
  if (!streamId || !title) return null;

  const extension = String(stream.container_extension || (kind === 'live' ? 'ts' : 'mp4')).toLowerCase();
  if (kind === 'vod' && !['mp4', 'm4v', 'mov', 'm3u8', 'ts', 'mkv'].includes(extension)) return null;
  if (kind === 'vod') vodExtensions.set(String(streamId), extension);

  return {
    id: `xtream-${kind}-${streamId}`,
    type: kind === 'live' ? 'live' : 'movie',
    title: kind === 'series' ? `${title} - first episode` : title,
    year: streamYear(stream),
    runtime: kind === 'live' ? 'live' : kind === 'series' ? 'series' : 'unknown',
    source: 'Xtream IPTV provider',
    poster: stream.stream_icon || stream.cover || '',
    playbackUrl: `/activity-provider/xtream/${kind}/${streamId}`,
    overview: kind === 'series' ? 'Xtream SERIES result; starts from the first available episode.' : `Xtream ${kind.toUpperCase()} stream${extension ? ` (${extension})` : ''}.`,
  };
}

function parseM3uAttributes(value: string) {
  const attrs: Record<string, string> = {};
  const regex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value))) attrs[match[1].toLowerCase()] = match[2];
  return attrs;
}

function parseM3uPlaylist(text: string): M3uEntry[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const entries: M3uEntry[] = [];
  let pending: Omit<M3uEntry, 'url'> | null = null;

  for (const line of lines) {
    if (line.startsWith('#EXTINF')) {
      const attrs = parseM3uAttributes(line);
      const commaIndex = line.indexOf(',');
      const title = (commaIndex >= 0 ? line.slice(commaIndex + 1) : attrs['tvg-name'] || '').trim();
      pending = {
        title: title || attrs['tvg-name'] || 'Untitled stream',
        group: attrs['group-title'],
        logo: attrs['tvg-logo'],
      };
      continue;
    }

    if (line.startsWith('#') || !pending) continue;
    entries.push({ ...pending, url: line });
    pending = null;
  }

  return entries;
}

function m3uEntryKind(entry: M3uEntry): 'movie' | 'live' | 'series' {
  const text = normalize(`${entry.group || ''} ${entry.title}`);
  if (/\bs\d{1,2}\s*e\d{1,2}\b/i.test(entry.title) || /\b(series|show|season|episode|tv series)\b/.test(text)) return 'series';
  if (/\b(live|channel|sports|news|24\/7)\b/.test(text)) return 'live';
  return 'movie';
}

function m3uCatalogItem(entry: M3uEntry, index: number): XtreamCatalogItem | null {
  if (!/^https?:\/\//i.test(entry.url)) return null;
  const kind = m3uEntryKind(entry);
  return {
    id: `m3u-${kind}-${index}`,
    type: kind === 'live' ? 'live' : 'movie',
    title: entry.title,
    year: new Date().getFullYear(),
    runtime: kind === 'live' ? 'live' : kind === 'series' ? 'series' : 'unknown',
    source: entry.group ? `M3U playlist: ${entry.group}` : 'M3U playlist',
    poster: entry.logo || '',
    playbackUrl: entry.url,
    overview: kind === 'series' ? 'M3U playlist series result.' : `M3U playlist ${kind} result.`,
  };
}

async function getM3uCatalog() {
  const playlistUrl = getPlaylistUrl();
  if (!playlistUrl) return [];
  const response = await fetch(playlistUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`M3U playlist returned ${response.status}`);
  const text = await response.text();
  return parseM3uPlaylist(text)
    .map(m3uCatalogItem)
    .filter((item): item is XtreamCatalogItem => Boolean(item));
}

async function fetchXtreamJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Xtream API returned ${response.status}`);
  return response.json() as Promise<T>;
}

export async function getXtreamStatus() {
  if (isMockEnabled()) {
    return {
      configured: true,
      mock: true,
      userInfo: { username: 'xtream-mock', status: 'Active' },
      serverInfo: { url: 'mock://xtream-compatible-test' },
    };
  }
  const config = getConfig();
  if (!config) return { configured: Boolean(getPlaylistUrl()), playlist: Boolean(getPlaylistUrl()) };
  const payload = await fetchXtreamJson<Record<string, unknown>>(playerApiUrl());
  const userInfo = payload.user_info && typeof payload.user_info === 'object'
    ? { ...(payload.user_info as Record<string, unknown>) }
    : payload.user_info || null;
  if (userInfo && typeof userInfo === 'object') delete (userInfo as Record<string, unknown>).password;
  return {
    configured: true,
    userInfo,
    serverInfo: payload.server_info || null,
  };
}

async function getXtreamCatalog() {
  if (isMockEnabled()) return MOCK_CATALOG;
  const hasXtreamConfig = Boolean(getConfig());
  const hasPlaylistConfig = Boolean(getPlaylistUrl());
  if (!hasXtreamConfig && !hasPlaylistConfig) return [];
  if (cachedStreams && cachedStreams.expiresAt > Date.now()) return cachedStreams.items;

  const [vod, live, series, playlist] = await Promise.all([
    hasXtreamConfig ? fetchXtreamJson<XtreamStream[]>(playerApiUrl('get_vod_streams')).catch(() => []) : Promise.resolve([]),
    hasXtreamConfig ? fetchXtreamJson<XtreamStream[]>(playerApiUrl('get_live_streams')).catch(() => []) : Promise.resolve([]),
    hasXtreamConfig && isSeriesSearchEnabled() ? fetchXtreamJson<XtreamStream[]>(playerApiUrl('get_series')).catch(() => []) : Promise.resolve([]),
    getM3uCatalog().catch((error) => {
      console.error('[Xtream] M3U playlist search failed:', error);
      return [];
    }),
  ]);

  const items = [
    ...series.map((stream) => toCatalogItem(stream, 'series')),
    ...vod.map((stream) => toCatalogItem(stream, 'vod')),
    ...playlist,
    ...live.slice(0, 500).map((stream) => toCatalogItem(stream, 'live')),
  ].filter((item): item is XtreamCatalogItem => Boolean(item));

  cachedStreams = { expiresAt: Date.now() + 5 * 60 * 1000, items };
  return items;
}

export async function searchXtreamCatalog(query: string | null | undefined) {
  const needle = normalize(query);
  if (!needle) return [];
  const items = await getXtreamCatalog();
  const matches = items
    .map((item) => ({ item, score: scoreItem(item, needle) }))
    .filter((entry) => entry.score >= 16)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((entry) => entry.item);

  const playable: XtreamCatalogItem[] = [];
  for (const item of matches) {
    if (item.id.startsWith('m3u-')) {
      playable.push(item);
      continue;
    }

    if (item.id.startsWith('xtream-vod-')) {
      playable.push(item);
      continue;
    }

    if (!item.id.startsWith('xtream-series-')) {
      playable.push(item);
      continue;
    }

    const seriesId = item.id.replace('xtream-series-', '');
    const hasEpisode = await getFirstSeriesEpisodeUrl(seriesId).then(() => true).catch(() => false);
    if (hasEpisode) {
      playable.push(item);
    } else {
      console.warn(`[Xtream] Skipping unplayable series result: ${item.title} (${seriesId})`);
    }
  }

  return playable;
}

export async function getXtreamStreamUrl(kind: XtreamKind, streamId: string) {
  const config = getConfig();
  if (!config) throw new Error('Xtream provider is not configured');
  const cleanId = String(streamId).replace(/[^0-9]/g, '');
  if (!cleanId) throw new Error('Invalid Xtream stream id');

  if (kind === 'vod' && !vodExtensions.has(cleanId)) {
    await getXtreamCatalog().catch(() => []);
  }

  const extension = kind === 'live' ? 'ts' : (vodExtensions.get(cleanId) || 'mp4');
  const pathKind = kind === 'live' ? 'live' : kind === 'series' ? 'series' : 'movie';
  return new URL(`/${pathKind}/${encodeURIComponent(config.username)}/${encodeURIComponent(config.password)}/${cleanId}.${extension}`, config.baseUrl);
}

export async function getResolvedXtreamStreamUrl(kind: XtreamKind, streamId: string) {
  return kind === 'series' ? getFirstSeriesEpisodeUrl(streamId) : getXtreamStreamUrl(kind, streamId);
}

async function getFirstSeriesEpisodeUrl(seriesId: string) {
  const config = getConfig();
  if (!config) throw new Error('Xtream provider is not configured');
  const cleanSeriesId = String(seriesId).replace(/[^0-9]/g, '');
  if (!cleanSeriesId) throw new Error('Invalid Xtream series id');

  const url = playerApiUrl('get_series_info');
  url.searchParams.set('series_id', cleanSeriesId);
  const info = await fetchXtreamJson<XtreamSeriesInfo>(url);
  const episodes = flattenSeriesEpisodes(info.episodes);

  if (episodes.length === 0) {
    const episodeShape = info.episodes && typeof info.episodes === 'object'
      ? {
          topKeys: Object.keys(info.episodes as Record<string, unknown>).slice(0, 5),
          firstValueType: (() => {
            const firstValue = Object.values(info.episodes as Record<string, unknown>)[0];
            return Array.isArray(firstValue) ? 'array' : typeof firstValue;
          })(),
        }
      : { type: typeof info.episodes };
    console.warn('[Xtream] No series episodes found in provider response shape:', JSON.stringify(episodeShape));
  }

  for (const episode of episodes) {
    const episodeId = firstStringValue(episode, ['id', 'stream_id', 'episode_id']);
    if (!episodeId) continue;
    const extension = firstStringValue(episode, ['container_extension', 'extension', 'container']) || 'ts';
    const cleanExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'ts';
    return new URL(`/series/${encodeURIComponent(config.username)}/${encodeURIComponent(config.password)}/${episodeId}.${cleanExtension}`, config.baseUrl);
  }

  throw new Error('No playable Xtream series episodes found');
}

function firstStringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null || value === '') continue;
    return String(value);
  }
  return '';
}

function flattenSeriesEpisodes(episodes: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(episodes)) {
    return episodes.flatMap((entry) => flattenSeriesEpisodes(entry));
  }

  if (!episodes || typeof episodes !== 'object') return [];

  const record = episodes as Record<string, unknown>;
  if (firstStringValue(record, ['id', 'stream_id', 'episode_id'])) return [record];

  return Object.keys(record)
    .sort((a, b) => Number(a) - Number(b))
    .flatMap((key) => flattenSeriesEpisodes(record[key]));
}

export async function fetchXtreamStream(kind: XtreamKind, streamId: string, range?: string | null, signal?: AbortSignal) {
  const upstreamUrl = await getResolvedXtreamStreamUrl(kind, streamId);
  const headers: Record<string, string> = { 'user-agent': 'DiscordStreamHub/1.0' };
  if (range) headers.range = range;
  const upstream = await fetch(upstreamUrl, {
    cache: 'no-store',
    headers,
    signal,
  });

  return {
    ok: upstream.ok,
    status: upstream.status,
    body: upstream.body as ReadableStream<Uint8Array> | null,
    contentType: upstream.headers.get('content-type') || (kind === 'live' ? 'video/mp2t' : 'video/mp4'),
    contentLength: upstream.headers.get('content-length'),
    contentRange: upstream.headers.get('content-range'),
    acceptRanges: upstream.headers.get('accept-ranges'),
  };
}
