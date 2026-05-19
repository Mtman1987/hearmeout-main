import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_ALLOWED_HOSTS = new Set([
  'test-streams.mux.dev',
  'storage.googleapis.com',
  'commondatastorage.googleapis.com',
  'archive.org',
]);

function allowedHosts() {
  const allowed = new Set(DEFAULT_ALLOWED_HOSTS);
  const configured = process.env.WATCH_PROXY_ALLOWED_HOSTS || '';
  configured
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
    .forEach((host) => allowed.add(host));

  return allowed;
}

function isManifest(url: URL, contentType: string | null) {
  return url.pathname.endsWith('.m3u8') || Boolean(contentType?.includes('mpegurl')) || Boolean(contentType?.includes('application/vnd.apple'));
}

function rewriteManifest(manifest: string, upstreamUrl: URL, proxyPath: string) {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const absolute = new URL(trimmed, upstreamUrl).toString();
      return `${proxyPath}?url=${encodeURIComponent(absolute)}`;
    })
    .join('\n');
}

function downloadFilename(url: URL) {
  const leaf = url.pathname.split('/').filter(Boolean).pop() || 'watch-media';
  return leaf.replace(/[^a-zA-Z0-9._-]/g, '-') || 'watch-media';
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get('url');
  const download = request.nextUrl.searchParams.get('download') === '1';
  if (!rawUrl) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }

  if (upstreamUrl.protocol !== 'https:' || !allowedHosts().has(upstreamUrl.hostname.toLowerCase())) {
    return NextResponse.json({ error: 'Playback host is not allowed' }, { status: 403 });
  }

  const upstreamHeaders: Record<string, string> = {
    'user-agent': 'DiscordStreamHub/1.0',
  };
  const range = request.headers.get('range');
  if (range) upstreamHeaders.range = range;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      cache: 'no-store',
      headers: upstreamHeaders,
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }
    throw error;
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: `Upstream returned ${upstream.status}` }, { status: upstream.status });
  }

  const contentType = upstream.headers.get('content-type');
  if (isManifest(upstreamUrl, contentType)) {
    const manifest = rewriteManifest(await upstream.text(), upstreamUrl, request.nextUrl.pathname);
    const headers = new Headers({
      'content-type': 'application/vnd.apple.mpegurl',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    if (download) {
      headers.set('content-disposition', `attachment; filename="${downloadFilename(upstreamUrl)}"`);
    }
    return new NextResponse(manifest, {
      headers,
    });
  }

  const responseHeaders = new Headers({
    'content-type': contentType || 'application/octet-stream',
    'cache-control': 'public, max-age=300',
    'access-control-allow-origin': '*',
  });

  for (const header of ['accept-ranges', 'content-length', 'content-range', 'etag', 'last-modified']) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders.set(header, value);
  }
  if (download) {
    responseHeaders.set('content-disposition', `attachment; filename="${downloadFilename(upstreamUrl)}"`);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
