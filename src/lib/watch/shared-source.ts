import { getResolvedWatchSession } from './watch-request-service';
import { getGlobalWatchSessionId, getMusicWatchSessionId, type WatchMediaKind } from '../watch-session';
import { getResolvedXtreamStreamUrl, type XtreamKind } from './xtream-provider';

export function currentSharedRequest(kind: WatchMediaKind, expectedRequestId?: string | null) {
  const session = getResolvedWatchSession(kind === 'music' ? getMusicWatchSessionId() : getGlobalWatchSessionId());
  if (!session.current || (expectedRequestId && session.current.requestId !== expectedRequestId)) return null;
  return session.current;
}
export async function resolveSharedSource(kind: WatchMediaKind, requestId: string, appOrigin: string) {
  const request = currentSharedRequest(kind, requestId);
  if (!request) return null;
  const item = request.item;
  const videoId = item.metadata?.videoId || item.id.match(/^youtube-([A-Za-z0-9_-]{11})$/)?.[1];
  if (kind === 'music' && videoId) return { requestId, kind, provider: 'youtube', videoId };
  const match = item.playbackUrl.match(/^\/activity-provider\/xtream\/(vod|series|live|episode)\/(.+)$/);
  const sourceUrl = match
    ? (await getResolvedXtreamStreamUrl(match[1] as XtreamKind, match[2])).toString()
    : new URL(item.playbackUrl, appOrigin).toString();
  // Resolving a provider can take time. Never return an obsolete source.
  if (!currentSharedRequest(kind, requestId)) return null;
  return { requestId, kind, provider: 'url', sourceUrl };
}
