import {
  GET as getCanonicalRequest,
  OPTIONS as optionsCanonicalRequest,
  POST as postCanonicalRequest,
} from '@/app/api/watch/sessions/[sessionId]/request/route';
import { recordLegacyRouteUse } from '@/lib/route-telemetry';

type RouteContext = { params: Promise<{ sessionId: string }> };

export function GET(request: Request, context: RouteContext) {
  recordLegacyRouteUse('/activity-request/[sessionId]', request);
  return getCanonicalRequest(request as never, context);
}

export function POST(request: Request, context: RouteContext) {
  recordLegacyRouteUse('/activity-request/[sessionId]', request);
  return postCanonicalRequest(request as never, context);
}

export const OPTIONS = optionsCanonicalRequest;
