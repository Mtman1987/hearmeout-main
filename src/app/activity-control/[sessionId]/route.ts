import {
  OPTIONS as optionsCanonicalControl,
  POST as postCanonicalControl,
} from '@/app/api/watch/sessions/[sessionId]/control/route';
import { recordLegacyRouteUse } from '@/lib/route-telemetry';

type RouteContext = { params: Promise<{ sessionId: string }> };

export function POST(request: Request, context: RouteContext) {
  recordLegacyRouteUse('/activity-control/[sessionId]', request);
  return postCanonicalControl(request, context);
}

export const OPTIONS = optionsCanonicalControl;
