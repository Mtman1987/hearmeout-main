import { NextResponse } from 'next/server';
import { PLAYBACK_CONTROLS_DISABLED } from '@/lib/watch-request-service';
export async function POST(_request: Request, _context: {params: Promise<{sessionId: string}>}) {
  return NextResponse.json({ error: PLAYBACK_CONTROLS_DISABLED }, { status: 410 });
}
export async function OPTIONS() { return new NextResponse(null, {status: 204}); }
