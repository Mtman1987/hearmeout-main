import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { db, ensureDb } from '@/lib/db';
import { config } from '@/lib/config';
import { getSession } from '@/lib/auth';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';
import { effectiveRoomExpiry, roomExpiryFrom } from '@/lib/room-lifecycle';
import { validVoiceRoomId, validVoiceSource, voiceSourceUrl } from '@/lib/stream-voice-access';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const alive = (r: any) => { const t = effectiveRoomExpiry(r?.expiresAt, r?.createdAt); return r && (t === null || t > Date.now()); };

export async function GET(request: NextRequest) {
  await ensureDb();
  if (request.nextUrl.searchParams.get('list') === '1') {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Sign in to HearMeOut' }, { status: 401, headers });
    const isAdmin = !!session.user?.isAdmin;
    const rooms = db.list('rooms').filter(r =>
      alive(r.data) &&
      (r.data.ownerId === session.uid || (isAdmin && r.id === 'mtman' && r.data.systemRoom === true))
    ).map(r => ({
      id: r.id,
      name: r.id === 'mtman' ? 'mtman' : (r.data.name || r.id),
      protected: !!r.data.password,
      password: r.data.password || '',
      broadcasting: !!r.data.streamVoiceEnabled,
    }));
    return NextResponse.json({ rooms }, { headers });
  }
  const roomId = request.nextUrl.searchParams.get('roomId') || '';
  const key = request.nextUrl.searchParams.get('sourceKey') || '';
  if (!validVoiceSource(roomId, key)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const room = db.get('rooms', roomId);
  if (!alive(room)) return NextResponse.json({ error: 'Room ended' }, { status: 410, headers });
  if (!room?.streamVoiceEnabled) return NextResponse.json({ error: 'Voice broadcast is disabled' }, { status: 403, headers });
  const expiresAt = effectiveRoomExpiry(room.expiresAt, room.createdAt);
  if (request.nextUrl.searchParams.get('statusOnly') === '1') return NextResponse.json({ enabled: true, expiresAt }, { headers });
  if (!config.livekit.apiKey || !config.livekit.apiSecret || !config.livekit.publicUrl) return NextResponse.json({ error: 'Voice transport is not configured' }, { status: 503, headers });
  const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: `stream-listener:${roomId}:${randomUUID()}`, name: 'Stream voice listener', ttl: '15m',
    metadata: JSON.stringify({ type: 'system-audio', hidden: true, source: 'stream-listener' }),
  });
  token.addGrant({ roomJoin: true, room: roomId, canPublish: false, canSubscribe: true, canPublishData: false });
  return NextResponse.json({ token: await token.toJwt(), url: config.livekit.publicUrl, roomId, expiresAt }, { headers });
}

export async function POST(request: NextRequest) {
  const internal = isDjWorkerRequest(request);
  const session = internal ? null : await getSession();
  if (!internal && !session) return NextResponse.json({ error: 'Sign in to HearMeOut' }, { status: 401, headers });
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || 'select');
  if (!['create', 'select', 'off'].includes(action)) return NextResponse.json({ error: 'Invalid action' }, { status: 400, headers });
  const roomId = action === 'create' ? `voice-${randomUUID()}` : String(body.roomId || '');
  if (!validVoiceRoomId(roomId)) return NextResponse.json({ error: 'Invalid room' }, { status: 400, headers });
  await ensureDb();
  const previous = db.get('rooms', roomId);
  const adminManagingSystemRoom = !internal && !!session?.user?.isAdmin && roomId === 'mtman' && previous?.systemRoom === true;
  const ownerId = internal ? String(body.ownerId || '') : (adminManagingSystemRoom ? String(previous?.ownerId || '') : session!.uid);
  if (!db.get('users', ownerId)) return NextResponse.json({ error: 'Room owner was not found' }, { status: 404, headers });
  if (action !== 'create' && !previous) return NextResponse.json({ error: 'Room not found' }, { status: 404, headers });
  if (previous && ((!previous.ownerId && !internal) || (previous.ownerId && previous.ownerId !== ownerId))) return NextResponse.json({ error: 'Only the room owner can broadcast it' }, { status: 403, headers });
  if (!internal && previous && !alive(previous)) return NextResponse.json({ error: 'This room expired. Create a new room.' }, { status: 410, headers });
  if (action === 'off') { db.update('rooms', roomId, { streamVoiceEnabled: false }); return NextResponse.json({ disabled: true }, { headers }); }
  const password = String(body.password || previous?.password || '');
  if (!password.trim()) return NextResponse.json({ error: 'Set a room password before broadcasting voices' }, { status: 400, headers });
  const permanentLounge = internal && roomId === 'mtman' && body.permanentLounge === true;
  const now = new Date().toISOString();
  const roomName = roomId === 'mtman' ? 'mtman' : String(body.name || previous?.name || 'Stream voice room').slice(0, 80);
  db.set('rooms', roomId, {
    name: roomName, ownerId, createdBy: ownerId,
    isPrivate: true, password, streamVoiceEnabled: true,
    ...(action === 'create' ? { createdAt: now, expiresAt: roomExpiryFrom(), playlist: [], isPlaying: false } : {}),
    ...(permanentLounge ? { createdAt: null, expiresAt: null, systemRoom: true, hidden: true } : {}),
    description: 'Live stream voice room. Your unmuted microphone is broadcast on stream.',
  }, { merge: true });
  return NextResponse.json({ roomId, name: roomName, roomUrl: `${config.baseUrl}/rooms/${roomId}`, sourceUrl: voiceSourceUrl(roomId, config.baseUrl) }, { headers });
}
