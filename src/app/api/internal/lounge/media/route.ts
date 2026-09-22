import { NextRequest, NextResponse } from 'next/server';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';
import { controlWatchSession, getPublicWatchSession, getWatchSession } from '@/lib/watch-request-service';
import { getRoomWatchSessionId } from '@/lib/watch-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOUNGE_ROOM_ID = 'system-spacemountainlive-lounge';
const LOUNGE_SESSION_ID = getRoomWatchSessionId(LOUNGE_ROOM_ID, 'music');
const CONTROL_ACTIONS = new Set(['play', 'pause', 'next', 'clear']);

function baseUrl(request: Request) {
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

function authorized(request: Request) {
  return isDjWorkerRequest(request);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Worker authentication required' }, { status: 401 });
  const session = getPublicWatchSession(
    getWatchSession(LOUNGE_SESSION_ID, undefined, undefined, 'music'),
    baseUrl(request),
  );
  return NextResponse.json({ success: true, roomId: LOUNGE_ROOM_ID, session }, {
    headers: { 'cache-control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Worker authentication required' }, { status: 401 });
  const body = await request.json().catch(() => null) as any;
  const requestedAction = String(body?.action || '').toLowerCase();
  const action = requestedAction === 'skip' ? 'next' : requestedAction;
  if (!CONTROL_ACTIONS.has(action)) {
    return NextResponse.json({ error: 'Unsupported Lounge media control' }, { status: 400 });
  }
  const expectedRequestId = String(body?.expectedRequestId || '').trim().slice(0, 200) || undefined;
  const session = await controlWatchSession(LOUNGE_SESSION_ID, action, undefined, undefined, {
    actorUserId: 'apollo-lounge-player',
    isAdmin: true,
    platform: 'admin',
    expectedRequestId,
  });
  return NextResponse.json({
    success: true,
    roomId: LOUNGE_ROOM_ID,
    session: getPublicWatchSession(session, baseUrl(request)),
  }, { headers: { 'cache-control': 'no-store' } });
}
