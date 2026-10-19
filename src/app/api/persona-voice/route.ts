import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, ensureDb } from '@/lib/db';
import { canManageRoom } from '@/lib/room-access';

const STREAMWEAVER_BASE_URL = String(process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev').replace(/\/$/, '');

async function authorize(request: NextRequest, roomId: string, tenantId: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) return { error: NextResponse.json({ error: 'Room not found' }, { status: 404 }) };
  if (!canManageRoom(session.user as any, room.ownerId || room.createdBy || room.hostId)) {
    return { error: NextResponse.json({ error: 'Only the room owner or room staff can change persona settings' }, { status: 403 }) };
  }
  if (!db.get('rooms/' + roomId + '/users', 'persona:' + tenantId)) {
    return { error: NextResponse.json({ error: 'That bot is not in this room' }, { status: 404 }) };
  }
  return { session };
}

async function upstream(path: string, init: RequestInit) {
  const secret = String(process.env.HEARMEOUT_PERSONA_VOICE_SECRET || process.env.BOT_SECRET_KEY || process.env.STREAMWEAVER_SECRET || '').trim();
  if (!secret) return NextResponse.json({ error: 'Voice settings service is not configured' }, { status: 503 });
  const response = await fetch(`${STREAMWEAVER_BASE_URL}${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, ...(init.headers || {}) },
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(30000) : undefined,
  }).catch(() => null);
  if (!response) return NextResponse.json({ error: 'Voice service is unavailable' }, { status: 502 });
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || 'Invalid voice service response' }; }
  return NextResponse.json(payload, { status: response.status, headers: { 'cache-control': 'private, no-store' } });
}

export async function GET(request: NextRequest) {
  const roomId = String(request.nextUrl.searchParams.get('roomId') || '').trim().slice(0, 160);
  const tenantId = String(request.nextUrl.searchParams.get('botId') || '').trim().slice(0, 128);
  if (!roomId || !tenantId) return NextResponse.json({ error: 'roomId and botId are required' }, { status: 400 });
  const access = await authorize(request, roomId, tenantId);
  if (access.error) return access.error;
  return upstream(`/api/internal/hearmeout/persona-voice?tenantId=${encodeURIComponent(tenantId)}`, { method: 'GET' });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as any;
  const roomId = String(body?.roomId || '').trim().slice(0, 160);
  const tenantId = String(body?.botId || '').trim().slice(0, 128);
  const voice = String(body?.voice || '').trim().slice(0, 128);
  const action = String(body?.action || '').trim().toLowerCase();
  if (!roomId || !tenantId || !voice || !['save', 'test'].includes(action)) {
    return NextResponse.json({ error: 'roomId, botId, voice, and a valid action are required' }, { status: 400 });
  }
  const access = await authorize(request, roomId, tenantId);
  if (access.error) return access.error;
  return upstream('/api/internal/hearmeout/persona-voice', {
    method: 'POST',
    body: JSON.stringify({ tenantId, voice, action }),
  });
}
