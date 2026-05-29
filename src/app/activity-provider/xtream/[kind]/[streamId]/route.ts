import { NextResponse } from 'next/server';
import { fetchXtreamStream, type XtreamKind } from '@/lib/xtream-provider';

function downloadFilename(streamId: string, contentType?: string | null) {
  const type = String(contentType || '').toLowerCase();
  const extension = type.includes('matroska') ? 'mkv' : type.includes('mpegurl') ? 'm3u8' : type.includes('mp2t') ? 'ts' : 'mp4';
  return `xtream-${streamId}.${extension}`;
}

export async function GET(request: Request, context: { params: Promise<{ kind: string; streamId: string }> }) {
  const { kind, streamId } = await context.params;
  const download = new URL(request.url).searchParams.get('download') === '1';
  if (kind !== 'vod' && kind !== 'live' && kind !== 'series' && kind !== 'episode') {
    return NextResponse.json({ error: 'Unsupported Xtream stream kind' }, { status: 400 });
  }

  try {
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
    if (download) headers.set('content-disposition', `attachment; filename="${downloadFilename(streamId, upstream.contentType)}"`);

    return new NextResponse(upstream.body as any, { status: upstream.status, headers });
  } catch (error: any) {
    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }
    return NextResponse.json({ error: error.message || 'Xtream stream failed' }, { status: 502 });
  }
}
