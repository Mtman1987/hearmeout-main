import { NextResponse } from 'next/server';
import { MUSIC_WATCH_SESSION_ID } from '@/lib/watch-session';
import { getResolvedWatchSession } from '@/lib/watch-request-service';
export async function GET() {
  const state = getResolvedWatchSession(MUSIC_WATCH_SESSION_ID);
  return NextResponse.json({ running: Boolean(state.current), mode: 'shared', sessionId: state.id, instances: [] });
}
export async function POST() {
  return NextResponse.json({ success: false, message: 'Playback controls are temporarily unavailable.' }, { status: 410 });
}
