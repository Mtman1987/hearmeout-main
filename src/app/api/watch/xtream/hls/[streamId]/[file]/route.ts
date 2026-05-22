import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { ensureXtreamHls, getXtreamHlsFile, waitForXtreamHlsIndex } from '@/lib/watch/xtream-hls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ streamId: string; file: string }> }) {
  const { streamId, file } = await context.params;

  try {
    if (file === 'index.m3u8') {
      ensureXtreamHls(streamId).catch(() => {});
      const ready = await waitForXtreamHlsIndex(streamId);
      if (!ready) {
        return NextResponse.json({ error: 'HLS stream is still preparing. Try again in a few seconds.' }, { status: 202 });
      }
    }

    const hlsFile = await getXtreamHlsFile(streamId, file);
    if (!hlsFile) {
      return NextResponse.json({ error: 'HLS file not found' }, { status: 404 });
    }

    return new NextResponse(Readable.toWeb(hlsFile.stream) as any, {
      status: 200,
      headers: {
        'content-type': hlsFile.contentType,
        'content-length': String(hlsFile.contentLength),
        'cache-control': file.endsWith('.m3u8') ? 'no-store' : 'public, max-age=3600',
        'access-control-allow-origin': '*',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'HLS conversion failed' }, { status: 502 });
  }
}
