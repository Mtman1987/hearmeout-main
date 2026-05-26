import { NextRequest, NextResponse } from 'next/server';
import { startDJ, stopDJ, isDJRunning, getActiveInstances } from '@/lib/dj-service';
import { getSession } from '@/lib/auth';
import { db, ensureDb } from '@/lib/db';

// Audit S9: only the room owner / admin / djWhitelist may start or stop the
// server-side DJ instance. Previously any authenticated user could hijack
// any room's DJ stream by POSTing { action: 'start', roomId }.
async function canControlRoom(uid: string, roomId: string): Promise<boolean> {
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) return false;
  const ownerId = room.ownerId || room.createdBy || room.hostId;
  if (ownerId === uid) return true;
  if (Array.isArray(room.djWhitelist) && room.djWhitelist.includes(uid)) return true;
  if (Array.isArray(room.admins) && room.admins.includes(uid)) return true;
  const user = db.get('users', uid);
  return !!user?.isAdmin;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { action, roomId } = await request.json();

    if (!roomId) {
      return NextResponse.json({ error: 'roomId required' }, { status: 400 });
    }

    if (!(await canControlRoom(session.uid, roomId))) {
      return NextResponse.json(
        { error: 'Forbidden: not authorized to control this room\'s DJ' },
        { status: 403 },
      );
    }

    if (action === 'start') {
      const result = await startDJ(roomId);
      return NextResponse.json(result, { status: result.success ? 200 : 503 });
    }

    if (action === 'stop') {
      const result = await stopDJ(roomId);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Invalid action. Use "start" or "stop".' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // GET is read-only status; require auth but no per-room ownership check
  // (the response only reveals whether the DJ is running, not any user data).
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get('roomId');

  if (roomId) {
    const running = await isDJRunning(roomId);
    return NextResponse.json({ running });
  }

  const instances = await getActiveInstances();
  return NextResponse.json({ instances });
}
