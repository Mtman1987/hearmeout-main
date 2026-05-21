import { NextResponse } from 'next/server';
import { getPublicWatchSession, getResolvedWatchSession } from '@/lib/watch-request-service';

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
  return NextResponse.json(getPublicWatchSession(getResolvedWatchSession(sessionId), getRequestBaseUrl(request)));
}
