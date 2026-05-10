import { NextRequest, NextResponse } from 'next/server';
import { startDJ, stopDJ, isDJRunning, getActiveInstances } from '@/lib/dj-service';
import { getSession } from '@/lib/auth';
import { db, ensureDb } from '@/lib/db';

async function canControlRoom(uid: string, roomId: string): Promise<boolean> {
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) return false;

  const ownerId = room.ownerId || room.createdBy || room.hostId;
  if (ownerId === uid) return true;
  if (Array.isArray(room.djWhitelist) && room.djWhitelist.includes(uid)) return true;
  if (Array.isArray(room.admins) && room.admins.includes(uid)) return true;

  const appUser = db.get('users', uid);
  return !!appUser?.isAdmin;
}

export async function POST(request: NextRequest) {
  const session = await getSession();

  try {
    const { action, roomId } = await request.json();

    if (!roomId) {
      return NextResponse.json({ error: 'roomId required', message: 'Room ID is required.' }, { status: 400 });
    }

    if (session && !(await canControlRoom(session.uid, roomId))) {
      // In dev, allow any authenticated user to control DJ
      if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'Only the room owner, an admin, or an approved DJ can control this room DJ.' },
          { status: 403 },
        );
      }
    }

    if (action === 'start') {
      const result = await startDJ(roomId);
      return NextResponse.json(result, { status: result.success ? 200 : 503 });
    }

    if (action === 'stop') {
      const result = await stopDJ(roomId);
      return NextResponse.json(result, { status: result.success ? 200 : 503 });
    }

    return NextResponse.json({ error: 'Invalid action', message: 'Use "start" or "stop".' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, message: 'DJ request failed.' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession();

  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get('roomId');

  if (roomId) {
    const running = await isDJRunning(roomId);
    return NextResponse.json({ running });
  }

  const instances = await getActiveInstances();
  return NextResponse.json({ instances });
}
