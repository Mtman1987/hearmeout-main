import { GLOBAL_WATCH_SESSION_ID, MUSIC_WATCH_SESSION_ID, normalizeWatchSessionAlias } from './watch-session';

// These two rooms are deliberately shared by Discord commands, Activities,
// and HearMeOut. Discord's proxy cannot carry the website's SPMT cookie.
function isSharedSession(value: string | null) {
  const raw = value?.trim().toLowerCase() || '';
  // Old Discord links and friendly media names resolve to the two public
  // sources. Arbitrary room names do not bypass website authentication.
  const allowed = !raw || [GLOBAL_WATCH_SESSION_ID, MUSIC_WATCH_SESSION_ID, 'music', 'movie', 'movies', 'watch'].includes(raw)
    || /^watch-discord-[a-z0-9-]+-(music|movie)$/.test(raw);
  if (!allowed) return false;
  const id = normalizeWatchSessionAlias(raw, GLOBAL_WATCH_SESSION_ID);
  return id === GLOBAL_WATCH_SESSION_ID || id === MUSIC_WATCH_SESSION_ID;
}

export function isActivityEntry(url: URL) {
  return ['/activity', '/activity-lite', '/activity-lite.js'].includes(url.pathname)
    || (url.pathname === '/' && Boolean(url.searchParams.get('frame_id')));
}

export function isPublicActivityRequest(url: URL, method: string) {
  const path = url.pathname;
  const read = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  if (isActivityEntry(url) || path === '/api/watch/activity-default') {
    return read && isSharedSession(url.searchParams.get('sessionId') || url.searchParams.get('session_id'));
  }

  const canonical = path.match(/^\/(?:api\/watch\/sessions|activity\/session)\/([^/]+)\/(state|request|accept|control|quick-control)$/);
  const legacy = path.match(/^\/activity-(state|request|control)\/([^/]+)(?:\/(accept))?$/);
  const sessionRoute = canonical || (legacy ? [legacy[0], legacy[2], legacy[3] || legacy[1]] : null);
  if (sessionRoute) {
    if (!isSharedSession(sessionRoute[1])) return false;
    return read || (method === 'POST' && ['request', 'accept', 'control'].includes(sessionRoute[2]));
  }

  // Only playback resources, not provider settings, worker controls, cache
  // uploads, or arbitrary private-room endpoints, bypass website login.
  if (!read) return false;
  if (/^\/api\/watch\/stream\/(movie|music)\/(index\.m3u8|init\.mp4|seg_\d+\.m4s)$/.test(path)) return true;
  if (['/api/activity/hls', '/activity-hls', '/activity/hls', '/api/watch/proxy', '/activity-proxy', '/activity/proxy'].includes(path)) return true;
  return /^\/(?:api\/watch|activity\/watch|activity-provider)\/(?:youtube|xtream)\/hls\/[^/]+\/[^/]+$/.test(path)
    || /^\/activity-provider\/xtream\/(?:vod|series|episode)\/[^/]+$/.test(path)
    || /^\/api\/youtube-audio\/[A-Za-z0-9_-]{11}$/.test(path);
}
