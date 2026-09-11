import { NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { ACTIVITY_ROOM_ID } from '@/lib/watch-session';
import { ensureDiscordActivityRoom } from '@/lib/activity-room';

export async function GET() {
  await ensureDb();
  const room = db.get('rooms', ACTIVITY_ROOM_ID);
  return NextResponse.json({ room });
}

export async function POST() {
  const room = await ensureDiscordActivityRoom();
  return NextResponse.json({ room });
}
