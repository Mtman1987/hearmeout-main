import { NextRequest, NextResponse } from 'next/server';
import { acceptWatchRecommendation, getPublicWatchSession } from '@/lib/watch-request-service';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const body = await request.json();
  const result = acceptWatchRecommendation({
    sessionId,
    userId: body.userId || 'local',
    username: body.username || 'local tester',
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 404, headers: CORS_HEADERS });
  }

  return NextResponse.json({
    request: result.request,
    session: getPublicWatchSession(result.session),
  }, {
    headers: CORS_HEADERS,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
