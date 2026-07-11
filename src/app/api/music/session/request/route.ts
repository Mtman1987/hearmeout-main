import { NextRequest, NextResponse } from 'next/server';
import { getPublicWatchSession, requestWatchMusicItem } from '@/lib/watch-request-service';
import { getMusicWatchSessionId } from '@/lib/watch-session';

function getRequestBaseUrl(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const proto = forwardedProto || url.protocol.replace(':', '');
  const host = forwardedHost || request.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const query = String(body.query || '').trim();
  if (!query) return NextResponse.json({ error: 'Missing query' }, { status: 400 });

  const result = await requestWatchMusicItem({
    sessionId: body.sessionId || getMusicWatchSessionId(),
    query,
    username: body.username || 'web user',
    platform: body.platform || 'web',
    userId: body.userId || body.username || 'web',
  });

  if ('error' in result) {
    return NextResponse.json({
      error: result.error,
      result: result.result,
    }, { status: 404 });
  }

  return NextResponse.json({
    result: result.result,
    request: result.request,
    session: getPublicWatchSession(result.session, getRequestBaseUrl(request)),
  });
}
