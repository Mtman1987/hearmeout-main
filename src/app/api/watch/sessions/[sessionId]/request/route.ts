import { NextRequest, NextResponse } from 'next/server';
import { getPublicWatchSession, requestWatchItem } from '@/lib/watch-request-service';

export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const body = await request.json();
  const result = await requestWatchItem({
    sessionId,
    query: body.query,
    itemId: body.itemId,
    userId: body.userId || 'local',
    username: body.username || 'local tester',
  });

  if ('error' in result) {
    return NextResponse.json({
      error: result.error,
      recommendation: result.recommendation || null,
      discovery: result.discovery || null,
    }, { status: 404 });
  }

  return NextResponse.json({
    request: result.request,
    session: getPublicWatchSession(result.session),
  });
}
