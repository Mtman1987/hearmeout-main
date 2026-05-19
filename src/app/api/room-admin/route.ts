import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { getSession } from '@/lib/auth';
import { db, ensureDb } from '@/lib/db';

const LK_HOST = process.env.NEXT_PUBLIC_LIVEKIT_URL?.replace('wss://', 'https://') || '';
const LK_KEY = process.env.LIVEKIT_API_KEY || '';
const LK_SECRET = process.env.LIVEKIT_API_SECRET || '';

function getLKClient() {
  if (!LK_HOST || !LK_KEY || !LK_SECRET) return null;
  return new RoomServiceClient(LK_HOST, LK_KEY, LK_SECRET);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureDb();

  const { action, roomId, targetUserId, targetRoomId } = await req.json();
  if (!action || !roomId) return NextResponse.json({ error: 'Missing action or roomId' }, { status: 400 });

  // Verify caller is room owner or DSH admin (Crew/VIP)
  const room = db.get('rooms', roomId);
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const isOwner = room.ownerId === session.uid;
  const userDoc = db.get('users', session.uid);
  const isAdmin = userDoc?.isAdmin === true;

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  if (!targetUserId) return NextResponse.json({ error: 'Missing targetUserId' }, { status: 400 });

  const lk = getLKClient();

  try {
    switch (action) {
      case 'ban': {
        // Add to ban list
        db.set(`rooms/${roomId}/banned`, targetUserId, {
          bannedBy: session.uid,
          bannedAt: new Date().toISOString(),
        });
        // Remove from room users
        db.delete(`rooms/${roomId}/users`, targetUserId);
        // Kick from LiveKit (if configured)
        if (!lk) return NextResponse.json({ success: true, action: 'banned', livekit: 'not-configured' });
        await lk.removeParticipant(roomId, targetUserId).catch(() => {});
        return NextResponse.json({ success: true, action: 'banned' });
      }

      case 'unban': {
        db.delete(`rooms/${roomId}/banned`, targetUserId);
        return NextResponse.json({ success: true, action: 'unbanned' });
      }

      case 'mute': {
        // Server-side mute via LiveKit — revoke publish permission (if configured)
        if (lk) {
          await lk.updateParticipant(roomId, targetUserId, undefined, {
            canPublish: false,
            canSubscribe: true,
            canPublishData: true,
          });
        }
        // Track in DB so UI can reflect it
        db.set(`rooms/${roomId}/users`, targetUserId, { serverMuted: true }, { merge: true });
        return NextResponse.json({ success: true, action: 'muted' });
      }

      case 'unmute': {
        if (lk) {
          await lk.updateParticipant(roomId, targetUserId, undefined, {
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
          });
        }
        db.set(`rooms/${roomId}/users`, targetUserId, { serverMuted: false }, { merge: true });
        return NextResponse.json({ success: true, action: 'unmuted' });
      }

      case 'kick': {
        db.delete(`rooms/${roomId}/users`, targetUserId);
        if (lk) await lk.removeParticipant(roomId, targetUserId).catch(() => {});
        return NextResponse.json({ success: true, action: 'kicked' });
      }

      case 'move': {
        if (!targetRoomId) return NextResponse.json({ error: 'Missing targetRoomId' }, { status: 400 });
        // Verify target room exists
        const targetRoom = db.get('rooms', targetRoomId);
        if (!targetRoom) return NextResponse.json({ error: 'Target room not found' }, { status: 404 });
        // Check user isn't banned in target room
        const banned = db.get(`rooms/${targetRoomId}/banned`, targetUserId);
        if (banned) return NextResponse.json({ error: 'User is banned from target room' }, { status: 403 });
        // Remove from current room in LiveKit (they'll rejoin target via client redirect)
        if (lk) await lk.removeParticipant(roomId, targetUserId).catch(() => {});
        // Move user data
        const userData = db.get(`rooms/${roomId}/users`, targetUserId);
        if (userData) {
          db.set(`rooms/${targetRoomId}/users`, targetUserId, userData);
          db.delete(`rooms/${roomId}/users`, targetUserId);
        }
        // Write a move instruction the client can poll for
        db.set(`rooms/${roomId}/moves`, targetUserId, {
          targetRoomId,
          targetRoomName: targetRoom.name || targetRoomId,
          movedAt: new Date().toISOString(),
          movedBy: session.uid,
        });
        return NextResponse.json({ success: true, action: 'moved', targetRoomId });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error(`[RoomAdmin] ${action} failed:`, error);
    return NextResponse.json({ error: `Action failed: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}
