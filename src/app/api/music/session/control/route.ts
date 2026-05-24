import { NextRequest, NextResponse } from 'next/server';
import { controlGlobalMusicSession } from '@/lib/music-session-service';

export async function POST(request: NextRequest) {
  const body = await request.json();
  try {
    return NextResponse.json(await controlGlobalMusicSession(
      String(body.action || '').toLowerCase(),
      Number(body.position || 0),
    ));
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unsupported action' }, { status: 400 });
  }
}
