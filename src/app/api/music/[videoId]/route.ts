import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';

const CACHE_DIR = process.env.MUSIC_CACHE_DIR || join(process.cwd(), 'data', 'music');
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{1,16}$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;

  if (!VIDEO_ID_RE.test(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
  }

  const filePath = resolve(CACHE_DIR, `${videoId}.mp3`);
  if (!filePath.startsWith(resolve(CACHE_DIR))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const file = readFileSync(filePath);
  const stat = statSync(filePath);

  return new NextResponse(file, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=604800',
      'Accept-Ranges': 'bytes',
    },
  });
}
