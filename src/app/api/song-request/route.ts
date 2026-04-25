import { NextRequest, NextResponse } from 'next/server';
import { addSongToPlaylist } from '@/lib/bot-actions';
import { db, ensureDb } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { song, requester } = await req.json();
    if (!song) return NextResponse.json({ error: 'Missing "song" field' }, { status: 400 });

    await ensureDb();
    const rooms = db.list('rooms');
    const roomId = rooms.length > 0 ? rooms[0].id : 'default';

    const result = await addSongToPlaylist(song, roomId, requester || 'StreamWeaver');
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || 'Internal error' }, { status: 500 });
  }
}
