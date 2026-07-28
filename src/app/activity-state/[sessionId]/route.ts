import { GET as getCanonicalState, OPTIONS as optionsCanonicalState } from '@/app/api/watch/sessions/[sessionId]/state/route';
import { recordLegacyRouteUse } from '@/lib/route-telemetry';

type RouteContext = { params: Promise<{ sessionId: string }> };

export function GET(request: Request, context: RouteContext) {
  recordLegacyRouteUse('/activity-state/[sessionId]', request);
  return getCanonicalState(request, context);
}

export const OPTIONS = optionsCanonicalState;
