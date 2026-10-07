import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

export async function GET() {
  // Movie HLS uses a separate EXT-X-MEDIA audio rendition. The light build
  // omits AudioTrackController/AudioStreamController and silently plays video only.
  const file = await readFile(join(process.cwd(), 'node_modules', 'hls.js', 'dist', 'hls.min.js'), 'utf8');
  return new NextResponse(file, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
