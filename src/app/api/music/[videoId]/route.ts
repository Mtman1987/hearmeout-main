import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CACHE_DIR = process.env.MUSIC_CACHE_DIR || '/data/music';

export async function GET(req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  const filePath = join(CACHE_DIR, `${videoId}.mp3`);

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const file = readFileSync(filePath);
  return new NextResponse(file, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=604800',
    },
  });
}
