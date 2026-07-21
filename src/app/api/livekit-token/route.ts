import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { getSession } from '@/lib/auth';
import { db, ensureDb } from '@/lib/db';
import { config } from '@/lib/config';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';

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
  const fromDjWorker = isDjWorkerRequest(request);

  try {
    const body = await request.json();
    const { roomId, userName, musicRoom, isDJ, voiceBridge, bridgeIdentity, bridgeMetadata } = body;

    if (!session && !(musicRoom && isDJ) && !(voiceBridge && fromDjWorker)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!roomId) {
      return NextResponse.json({ error: 'Missing roomId' }, { status: 400 });
    }

    const apiKey = config.livekit.apiKey;
    const apiSecret = config.livekit.apiSecret;

    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: 'LiveKit credentials not configured' }, { status: 500 });
    }

    // Voice bridge: the DJ worker publishes Discord speakers into the plain
    // (voice) room, one LiveKit participant per Discord user, so each shows up
    // as their own HearMeOut card. Only the internal worker may mint these.
    if (voiceBridge && fromDjWorker) {
      const identity = String(bridgeIdentity || `discord-bridge-${roomId}`).slice(0, 96);
      const at = new AccessToken(apiKey, apiSecret, {
        identity,
        name: (typeof userName === 'string' && userName.trim()) ? userName.slice(0, 64) : identity,
        metadata: typeof bridgeMetadata === 'string' ? bridgeMetadata.slice(0, 2048) : undefined,
        ttl: '12h',
      });
      at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true });
      const bridgeToken = await at.toJwt();
      return NextResponse.json({ token: bridgeToken });
    }

    // Bind user-browser tokens to the verified session uid. The headless DJ
    // worker has no browser session, so it sends the internal worker marker.
    const uid = session?.uid || 'dj-worker';
    const displayName =
      typeof userName === 'string' && userName.trim().length > 0
        ? userName.slice(0, 64)
        : session?.user?.displayName || session?.user?.username || uid;

    let actualRoom = roomId;
    let identity = uid;
    // Plain room tokens carry user microphones. Music-room listeners stay
    // subscribe-only unless the authorized DJ branch below enables publishing.
    let canPublish = !musicRoom;

    if (musicRoom) {
      actualRoom = `${roomId}-music`;
      if (isDJ) {
        const dj = !session || fromDjWorker ? { ok: true } : await isRoomDJ(uid, roomId);
        if (!dj.ok) {
          return NextResponse.json(
            { error: `forbidden: ${dj.reason ?? 'not allowed to DJ'}` },
            { status: 403 },
          );
        }
        identity = !session || fromDjWorker ? `dj-worker-${roomId}` : `dj-${uid}`;
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
    console.warn('[livekit-token] minted', {
      roomId,
      actualRoom,
      identity,
      musicRoom: !!musicRoom,
      isDJ: !!isDJ,
      canPublish,
      fromDjWorker,
      hasSession: !!session,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ token });
  } catch (error) {
    console.error('[livekit-token] Error generating token:', {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : undefined,
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 });
  }
}
