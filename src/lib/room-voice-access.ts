import { cookies } from 'next/headers';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getSession } from './auth';
import { db, ensureDb } from './db';
import { effectiveRoomExpiry } from './room-lifecycle';
import { config } from './config';

export function roomAccessCookie(roomId: string) { return 'hmo_room_' + createHash('sha256').update(roomId).digest('hex').slice(0, 20); }
export function roomAccessValue(roomId: string, uid: string, password: string) {
  if (!config.jwtSecret) throw new Error('Room access signing is unavailable');
  return createHmac('sha256', config.jwtSecret).update(JSON.stringify(['room-access-v1', roomId, uid, password])).digest('base64url');
}
export async function requireRoomVoiceAccess(roomId: string) {
  const session = await getSession();
  if (!session) throw new Error('Sign in to join a voice room');
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) throw new Error('Room was not found');
  const expires = effectiveRoomExpiry(room.expiresAt, room.createdAt);
  if (expires !== null && expires <= Date.now()) throw new Error('Room expired');
  if (db.get(`rooms/${roomId}/banned`, session.uid)) throw new Error('You are banned from this room');
  if (room.isPrivate && room.password && room.ownerId !== session.uid && !session.user?.isAdmin) {
    const expected = Buffer.from(roomAccessValue(roomId, session.uid, room.password));
    const actual = Buffer.from((await cookies()).get(roomAccessCookie(roomId))?.value || '');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Room password is required');
  }
  return session;
}
