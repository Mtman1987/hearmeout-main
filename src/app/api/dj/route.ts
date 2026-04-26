import { NextRequest, NextResponse } from 'next/server';
import { startDJ, stopDJ, isDJRunning, getActiveInstances } from '@/lib/dj-service';
import { db, ensureDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

interface RoomDoc { ownerId?: string }

// Authenticated DJ-control endpoint. Each start launches a headless Chromium
// process (~150MB). Without this gate, any unauthenticated caller could
// exhaust the Fly.io machine's memory by hammering /api/dj?action=start with
// arbitrary roomIds. Restrict mutating actions to the room owner (or admin).
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, roomId } = await request.json();
    if (!roomId) {
      return NextResponse.json({ error: 'roomId required' }, { status: 400 });
    }

    await ensureDb();
    const room = db.get('rooms', roomId) as RoomDoc | null;
    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    const sessionUser = (session.user as { isAdmin?: boolean } | null) ?? null;
    const isOwner = room.ownerId === session.uid;
    const isAdmin = !!sessionUser?.isAdmin;
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get('roomId');

  if (roomId) {
    return NextResponse.json({ running: isDJRunning(roomId) });
  }

  return NextResponse.json({ instances: getActiveInstances() });
}
