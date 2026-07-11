import { NextResponse } from 'next/server';
import { ensureDiscordActivityRoom } from '@/lib/activity-room';

export async function GET() {
  const room = await ensureDiscordActivityRoom();
  return NextResponse.json({ room });
}

export async function POST() {
  const room = await ensureDiscordActivityRoom();
  return NextResponse.json({ room });
}
