import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ROOM_ID = 'system-spacemountainlive-lounge';
const PROXY_PREFIX = '/api/system/spacemountainlive-lounge/apollo';
const APOLLO_LOUNGE_ORIGIN = new URL(
  process.env.APOLLO_LOUNGE_ORIGIN || 'https://web-terminal-bvesa.sprites.app',
).origin;

function allowedPath(path: string) {
  if (path === 'api/watch/broadcast/state') return true;
  return new RegExp(`^api/watch/sessions/${ROOM_ID}/broadcast/[A-Za-z0-9._-]+$`).test(path);
}

function copyHeaders(source: Headers) {
  const headers = new Headers({
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'content-type, range',
  });
  for (const name of [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
  ]) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/');
  if (!allowedPath(path)) {
    return NextResponse.json({ error: 'Unsupported Apollo Lounge path' }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const upstream = new URL(`/${path}`, APOLLO_LOUNGE_ORIGIN);
  if (path === 'api/watch/broadcast/state') {
    upstream.searchParams.set('roomId', ROOM_ID);
  } else {
    upstream.search = requestUrl.search;
  }

  const requestHeaders = new Headers({ Accept: request.headers.get('accept') || '*/*' });
  const range = request.headers.get('range');
  if (range) requestHeaders.set('range', range);

  const response = await fetch(upstream, {
    method: request.method,
    headers: requestHeaders,
    cache: 'no-store',
    redirect: 'error',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(60_000) : undefined,
  }).catch(() => null);

  if (!response) {
    return NextResponse.json({ error: 'Apollo Lounge is temporarily unavailable' }, { status: 502 });
  }

  const headers = copyHeaders(response.headers);
  const contentType = response.headers.get('content-type') || '';
  if (/mpegurl/i.test(contentType) || path.endsWith('.m3u8')) {
    const manifest = await response.text();
    const rewritten = manifest
      .replaceAll(`${APOLLO_LOUNGE_ORIGIN}/api/watch/`, `${PROXY_PREFIX}/api/watch/`)
      .replace(/(^|["'\s])\/api\/watch\//gm, `$1${PROXY_PREFIX}/api/watch/`);
    headers.delete('content-length');
    return new NextResponse(request.method === 'HEAD' ? null : rewritten, {
      status: response.status,
      headers,
    });
  }

  return new NextResponse(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers,
  });
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context);
}

export async function HEAD(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'content-type, range',
    },
  });
}
