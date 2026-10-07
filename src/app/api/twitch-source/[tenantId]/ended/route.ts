import { NextResponse } from 'next/server';
import { validTwitchSource } from '@/lib/twitch-source-access';
import { twitchMusicSessionId } from '@/lib/twitch-media-scope';
import { controlWatchSession, getPublicWatchSession, getWatchSession } from '@/lib/watch-request-service';
export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await context.params;
  if (!validTwitchSource(tenantId, request.headers.get('x-source-key') || '')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!body.expectedRequestId) return NextResponse.json({ error: 'Current request is required' }, { status: 400 });
  const sessionId = twitchMusicSessionId(tenantId);
  const current = getWatchSession(sessionId);
  if (current.current?.requestId !== body.expectedRequestId) return NextResponse.json({ ignored: true });
  const session = await controlWatchSession(sessionId, 'next', undefined, undefined, { isAdmin: true, platform: 'admin', expectedRequestId: body.expectedRequestId });
  return NextResponse.json(getPublicWatchSession(session), { headers: { 'cache-control': 'no-store' } });
}
