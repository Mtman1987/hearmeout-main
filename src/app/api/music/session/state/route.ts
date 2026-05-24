import { NextResponse } from 'next/server';
import { getGlobalMusicSession } from '@/lib/music-session-service';

export async function GET() {
  return NextResponse.json(await getGlobalMusicSession());
}
