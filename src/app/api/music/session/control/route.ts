import { POST as postCanonicalControl } from '@/app/api/watch/sessions/[sessionId]/control/route';
import { recordLegacyRouteUse } from '@/lib/route-telemetry';
import { getMusicWatchSessionId } from '@/lib/watch-session';

export function POST(request: Request) {
  recordLegacyRouteUse('/api/music/session/control', request);
  return postCanonicalControl(request, {
    params: Promise.resolve({ sessionId: getMusicWatchSessionId() }),
  });
}
