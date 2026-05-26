import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { ensureXtreamHls, getXtreamHlsFile, waitForXtreamHlsIndex } from '@/lib/watch/xtream-hls';
import { getXtreamStreamUrl } from '@/lib/watch/xtream-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, range',
};

export async function GET(_request: Request, context: { params: Promise<{ streamId: string; file: string }> }) {
  const { streamId, file } = await context.params;

  try {
    const workerUrl = getDjWorkerUrl();
    if (workerUrl) {
      const remoteUrl = new URL(`${workerUrl}/watch/xtream/hls/${encodeURIComponent(streamId)}/${encodeURIComponent(file)}`);
      if (file === 'index.m3u8') {
        const upstreamUrl = await getXtreamStreamUrl('vod', streamId);
        remoteUrl.searchParams.set('source', upstreamUrl.toString());
      }

      const workerResponse = await fetch(remoteUrl, {
        headers: {
          'user-agent': 'HearMeOut/1.0',
        },
      });

      const headers = new Headers(CORS_HEADERS);
      for (const header of ['content-type', 'content-length', 'cache-control']) {
        const value = workerResponse.headers.get(header);
        if (value) headers.set(header, value);
      }

      return new NextResponse(workerResponse.body, {
        status: workerResponse.status,
        headers,
      });
    }

    if (file === 'index.m3u8') {
      ensureXtreamHls(streamId).catch(() => {});
      const ready = await waitForXtreamHlsIndex(streamId);
      if (!ready) {
        return NextResponse.json({ error: 'HLS stream is still preparing. Try again in a few seconds.' }, { status: 202, headers: CORS_HEADERS });
      }
    }

    const hlsFile = await getXtreamHlsFile(streamId, file);
    if (!hlsFile) {
      return NextResponse.json({ error: 'HLS file not found' }, { status: 404, headers: CORS_HEADERS });
    }

    return new NextResponse(Readable.toWeb(hlsFile.stream) as any, {
      status: 200,
      headers: {
        'content-type': hlsFile.contentType,
        'content-length': String(hlsFile.contentLength),
        'cache-control': file.endsWith('.m3u8') ? 'no-store' : 'public, max-age=3600',
        ...CORS_HEADERS,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'HLS conversion failed' }, { status: 502, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
