import { NextResponse } from 'next/server';
import { getPublicWatchSession, getResolvedWatchSession } from '@/lib/watch-request-service';
import { getGlobalMusicWatchSession } from '@/lib/music-session-service';
import { MUSIC_WATCH_SESSION_ID } from '@/lib/watch-session';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function getRequestBaseUrl(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const proto = forwardedProto || url.protocol.replace(':', '');
  const host = forwardedHost || request.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (sessionId === MUSIC_WATCH_SESSION_ID) {
    return NextResponse.json(await getGlobalMusicWatchSession(getRequestBaseUrl(request)), {
      headers: CORS_HEADERS,
    });
  }
  return NextResponse.json(getPublicWatchSession(getResolvedWatchSession(sessionId), getRequestBaseUrl(request)), {
    headers: CORS_HEADERS,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
