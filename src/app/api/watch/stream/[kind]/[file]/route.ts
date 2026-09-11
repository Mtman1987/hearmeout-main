import { NextResponse } from 'next/server';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';
import { currentSharedRequest } from '@/lib/watch/shared-source';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ kind: string; file: string }> }) {
  const { kind, file } = await context.params;
  if ((kind !== 'movie' && kind !== 'music') || !/^(index\.m3u8|init\.mp4|seg_\d+\.m4s)$/.test(file)) return NextResponse.json({ error: 'Invalid stream file' }, { status: 400 });
  const url = new URL(request.url);
  const expected = url.searchParams.get('requestId');
  const current = currentSharedRequest(kind, expected);
  if (!current) return NextResponse.json({ error: 'Source changed' }, { status: 409 });
  const worker = getDjWorkerUrl();
  if (!worker) return NextResponse.json({ error: 'Media worker is unavailable' }, { status: 503 });
  const upstream = new URL(`${worker}/shared-media/${kind}/${file}`);
  upstream.searchParams.set('requestId', current.requestId);
  try {
    const response = await fetch(upstream, { headers: getDjWorkerRequestHeaders(), cache: 'no-store' });
    if (!currentSharedRequest(kind, current.requestId)) return NextResponse.json({ error: 'Source changed' }, { status: 409 });
    const headers = new Headers({ 'cache-control': 'no-store', 'content-type': response.headers.get('content-type') || 'application/octet-stream' });
    if (file !== 'index.m3u8' || !response.ok) return new NextResponse(response.body, { status: response.status, headers });
    // Relative segment/map URLs work identically on the website and under
    // Discord's /.proxy prefix, and carry the same generation guard.
    const suffix = `?requestId=${encodeURIComponent(current.requestId)}`;
    const manifest = (await response.text()).split('\n').map(line => {
      if (line.startsWith('#EXT-X-MAP:')) return line.replace(/URI="([^"]+)"/, (_, uri) => `URI="${uri}${suffix}"`);
      return line.trim() && !line.startsWith('#') ? line + suffix : line;
    }).join('\n');
    return new NextResponse(manifest, { headers });
  } catch { return NextResponse.json({ error: 'The shared stream is reconnecting' }, { status: 503 }); }
}
