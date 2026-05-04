import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { getSession } from '@/lib/auth';
import { db, ensureDb } from '@/lib/db';
import { config } from '@/lib/config';

// Mints LiveKit access tokens. Two security properties enforced here:
//   1. (audit S8) Caller MUST be authenticated. The session uid is bound into
//      the LiveKit identity so a malicious client can't impersonate someone
//      else by picking a userId.
//   2. (audit S9 + A1) Only the room owner / admins / users marked djWhitelist
//      may publish music as a DJ. Listeners get subscribe-only tokens.
//      DJ identity is `dj-<uid>` (per-user) instead of the old hardcoded
//      'HearMeOutDJ' so multiple rooms can DJ in parallel without colliding.

async function isRoomDJ(uid: string, roomId: string): Promise<{
  ok: boolean;
  reason?: string;
}> {
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) return { ok: false, reason: 'room not found' };
  const ownerId = room.ownerId || room.createdBy || room.hostId;
  if (ownerId === uid) return { ok: true };
  if (Array.isArray(room.djWhitelist) && room.djWhitelist.includes(uid)) return { ok: true };
  if (Array.isArray(room.admins) && room.admins.includes(uid)) return { ok: true };
  const user = db.get('users', uid);
  if (user?.isAdmin) return { ok: true };
  return { ok: false, reason: 'not authorized to DJ this room' };
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { roomId, userName, musicRoom, isDJ } = body;

    if (!roomId) {
      return NextResponse.json({ error: 'Missing roomId' }, { status: 400 });
    }

    const apiKey = config.livekit.apiKey;
    const apiSecret = config.livekit.apiSecret;

    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: 'LiveKit credentials not configured' }, { status: 500 });
    }

    // Bind LiveKit identity to the verified session uid (do NOT trust client userId).
    const uid = session.uid;
    const displayName =
      typeof userName === 'string' && userName.trim().length > 0
        ? userName.slice(0, 64)
        : session.user?.displayName || session.user?.username || uid;

    let actualRoom = roomId;
    let identity = uid;
    let canPublish = false;

    if (musicRoom) {
      actualRoom = `${roomId}-music`;
      if (isDJ) {
        const dj = await isRoomDJ(uid, roomId);
        if (!dj.ok) {
          return NextResponse.json(
            { error: `forbidden: ${dj.reason ?? 'not allowed to DJ'}` },
            { status: 403 },
          );
        }
        identity = `dj-${uid}`;
        canPublish = true;
      } else {
        identity = `listener-${uid}`;
      }
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: isDJ ? `DJ ${displayName}` : displayName,
    });

    at.addGrant({
      roomJoin: true,
      room: actualRoom,
      canPublish,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    return NextResponse.json({ token });
  } catch (error) {
    console.error('Error generating LiveKit token:', error);
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 });
  }
}
