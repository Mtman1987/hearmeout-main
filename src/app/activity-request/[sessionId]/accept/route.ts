import {
  OPTIONS as optionsCanonicalAccept,
  POST as postCanonicalAccept,
} from '@/app/api/watch/sessions/[sessionId]/accept/route';
import { recordLegacyRouteUse } from '@/lib/route-telemetry';

type RouteContext = { params: Promise<{ sessionId: string }> };

export function POST(request: Request, context: RouteContext) {
  recordLegacyRouteUse('/activity-request/[sessionId]/accept', request);
  return postCanonicalAccept(request as never, context);
}

export const OPTIONS = optionsCanonicalAccept;
