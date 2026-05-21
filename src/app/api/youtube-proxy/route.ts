import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtubei.googleapis.com',
  'i.ytimg.com',
  'ytimg.com',
  'googlevideo.com',
  'rr1---sn-',
]);

function isAllowedYoutubeUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.endsWith('googlevideo.com')) return true;
    if (url.hostname.endsWith('ytimg.com')) return true;
    return ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
function toHeaders(entries: [string, string][]) {
  const headers = new Headers();
  for (const [key, value] of entries) {
    const lower = key.toLowerCase();
    if (['host', 'origin', 'referer', 'content-length', 'connection', 'cookie'].includes(lower)) {
      continue;
    }
    headers.set(key, value);
  }
  return headers;
}

export async function POST(req: NextRequest) {
  try {
    const { url, method, headers, body } = await req.json();
    if (typeof url !== 'string' || !isAllowedYoutubeUrl(url)) {
      return NextResponse.json({ error: 'Invalid or disallowed url' }, { status: 400 });
    }

    const upstream = await fetch(url, {
      method: typeof method === 'string' ? method : 'GET',
      headers: toHeaders(Array.isArray(headers) ? headers : []),
      body: typeof body === 'string' && body.length > 0 ? body : undefined,
      redirect: 'follow',
    });

    const responseHeaders = new Headers();
    const contentType = upstream.headers.get('content-type');
    const contentLength = upstream.headers.get('content-length');
    const cacheControl = upstream.headers.get('cache-control');
    const acceptRanges = upstream.headers.get('accept-ranges');
    const contentRange = upstream.headers.get('content-range');
    if (contentType) responseHeaders.set('Content-Type', contentType);
    if (contentLength) responseHeaders.set('Content-Length', contentLength);
    if (cacheControl) responseHeaders.set('Cache-Control', cacheControl);
    if (acceptRanges) responseHeaders.set('Accept-Ranges', acceptRanges);
    if (contentRange) responseHeaders.set('Content-Range', contentRange);
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
