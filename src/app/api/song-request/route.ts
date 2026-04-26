import { NextRequest, NextResponse } from 'next/server';
import { addSongToPlaylist } from '@/lib/bot-actions';
import { db, ensureDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

// Authenticated song-request endpoint. Writes to room playlists, which the
// firestore.rules require an authenticated principal for.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { song, roomId: roomIdInput, requester } = await req.json();
    if (!song) return NextResponse.json({ error: 'Missing "song" field' }, { status: 400 });

    await ensureDb();
    let roomId: string | undefined = roomIdInput;
    if (!roomId) {
      const rooms = db.list('rooms');
      roomId = rooms.length > 0 ? rooms[0].id : 'default';
    }

    const sessionUser = (session.user as { displayName?: string; name?: string } | null) ?? null;
    const fallbackName =
      (typeof requester === 'string' && requester.trim()) ||
      sessionUser?.displayName ||
      sessionUser?.name ||
      session.uid;

    const result = await addSongToPlaylist(song, roomId, fallbackName);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
