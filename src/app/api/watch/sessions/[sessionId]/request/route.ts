import { NextRequest, NextResponse } from 'next/server';
import { getPublicWatchSession, requestWatchItem } from '@/lib/watch-request-service';

function getRequestBaseUrl(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const proto = forwardedProto || url.protocol.replace(':', '');
  const host = forwardedHost || request.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

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
    session: getPublicWatchSession(result.session, getRequestBaseUrl(request)),
  });
}
