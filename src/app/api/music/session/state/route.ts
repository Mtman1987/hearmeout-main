import { GET as getCanonicalState } from '@/app/api/watch/sessions/[sessionId]/state/route';
import { recordLegacyRouteUse } from '@/lib/route-telemetry';
import { getMusicWatchSessionId } from '@/lib/watch-session';

export function GET(request: Request) {
  recordLegacyRouteUse('/api/music/session/state', request);
  return getCanonicalState(request, {
    params: Promise.resolve({ sessionId: getMusicWatchSessionId() }),
  });
}
