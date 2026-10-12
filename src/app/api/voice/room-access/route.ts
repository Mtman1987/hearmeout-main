import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { db, ensureDb } from '@/lib/db';
import { roomAccessCookie, roomAccessValue } from '@/lib/room-voice-access';
import { effectiveRoomExpiry } from '@/lib/room-lifecycle';
import { timingSafeEqual } from 'node:crypto';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in to join this room' }, { status: 401 });
  const { roomId, password } = await request.json().catch(() => ({}));
  await ensureDb();
  const room = db.get('rooms', String(roomId || ''));
  const expires = effectiveRoomExpiry(room?.expiresAt, room?.createdAt);
  if (!room || (expires !== null && expires <= Date.now())) return NextResponse.json({ error: 'Room ended' }, { status: 410 });
  const expected = Buffer.from(String(room.password || ''));
  const supplied = Buffer.from(String(password || ''));
  if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return NextResponse.json({ error: 'Incorrect password' }, { status: 403 });
  (await cookies()).set(roomAccessCookie(roomId), roomAccessValue(roomId, session.uid, room.password), { httpOnly: true, secure: process.env.NODE_ENV !== 'development', sameSite: 'lax', path: '/', maxAge: Math.max(1, Math.floor(((expires || Date.now() + 21600000) - Date.now()) / 1000)) });
  return NextResponse.json({ allowed: true }, { headers: { 'Cache-Control': 'no-store' } });
}
