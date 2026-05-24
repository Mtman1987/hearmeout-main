import { NextRequest, NextResponse } from 'next/server';
import { requestMusicItem } from '@/lib/music-session-service';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const query = String(body.query || '').trim();
  if (!query) return NextResponse.json({ error: 'Missing query' }, { status: 400 });

  const result = await requestMusicItem({
    query,
    username: body.username || 'web user',
    platform: body.platform || 'web',
  });

  return NextResponse.json(result, { status: result.result.success ? 200 : 404 });
}
