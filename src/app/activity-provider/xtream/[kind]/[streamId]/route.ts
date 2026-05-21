import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { createCachedReadStream, getXtreamVodCache, isXtreamVodCacheInProgress, startXtreamVodCache, waitForXtreamVodCacheRange } from '@/lib/xtream-cache';
import { fetchXtreamStream, type XtreamKind } from '@/lib/xtream-provider';

function downloadFilename(streamId: string, contentType?: string | null) {
  const type = String(contentType || '').toLowerCase();
  const extension = type.includes('matroska') ? 'mkv' : type.includes('mpegurl') ? 'm3u8' : type.includes('mp2t') ? 'ts' : 'mp4';
  return `xtream-${streamId}.${extension}`;
}

export async function GET(request: Request, context: { params: Promise<{ kind: string; streamId: string }> }) {
  const { kind, streamId } = await context.params;
  const download = new URL(request.url).searchParams.get('download') === '1';
  if (kind !== 'vod' && kind !== 'live' && kind !== 'series') {
    return NextResponse.json({ error: 'Unsupported Xtream stream kind' }, { status: 400 });
  }

  try {
    if (kind === 'vod') {
      const cached = await getXtreamVodCache(streamId).catch(() => null);
      if (cached) {
        const cachedResponse = createCachedReadStream(cached, request.headers.get('range'));
        if (cachedResponse) {
          const headers = new Headers();
          for (const [key, value] of Object.entries(cachedResponse.headers)) {
            if (value !== undefined) headers.set(key, value);
          }
          headers.set('cache-control', 'public, max-age=300');
          headers.set('access-control-allow-origin', '*');
          if (download) headers.set('content-disposition', `attachment; filename="${downloadFilename(streamId, cachedResponse.headers['content-type'])}"`);
          return new NextResponse(Readable.toWeb(cachedResponse.stream) as any, {
            status: cachedResponse.status,
            headers,
          });
        }
      }

      startXtreamVodCache(streamId, `VOD ${streamId}`);
      if (isXtreamVodCacheInProgress(streamId)) {
        const partial = await waitForXtreamVodCacheRange(streamId, request.headers.get('range'));
        if (partial) {
          const headers = new Headers();
          for (const [key, value] of Object.entries(partial.headers)) {
            if (value !== undefined) headers.set(key, value);
          }
          headers.set('cache-control', 'no-store');
          headers.set('access-control-allow-origin', '*');
          if (download) headers.set('content-disposition', `attachment; filename="${downloadFilename(streamId, partial.headers['content-type'])}"`);
          return new NextResponse(Readable.toWeb(partial.stream) as any, {
            status: partial.status,
            headers,
          });
        }
      }
    }

    const upstream = await fetchXtreamStream(kind as XtreamKind, streamId, request.headers.get('range'), request.signal);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `Xtream stream returned ${upstream.status}` }, { status: upstream.status || 502 });
    }

    const headers = new Headers({
      'content-type': upstream.contentType,
      'cache-control': 'no-store',
      'accept-ranges': upstream.contentRange ? 'bytes' : upstream.acceptRanges || 'bytes',
      'access-control-allow-origin': '*',
    });
    if (upstream.contentLength) headers.set('content-length', upstream.contentLength);
    if (upstream.contentRange) headers.set('content-range', upstream.contentRange);
    if (download && kind === 'vod') headers.set('content-disposition', `attachment; filename="${downloadFilename(streamId, upstream.contentType)}"`);

    return new NextResponse(upstream.body as any, { status: upstream.status, headers });
  } catch (error: any) {
    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }
    return NextResponse.json({ error: error.message || 'Xtream stream failed' }, { status: 502 });
  }
}
