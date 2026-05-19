import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

export async function GET() {
  const file = await readFile(join(process.cwd(), 'node_modules', 'hls.js', 'dist', 'hls.light.min.js'), 'utf8');
  return new NextResponse(file, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
