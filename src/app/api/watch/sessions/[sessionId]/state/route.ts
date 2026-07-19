import { NextResponse } from 'next/server';
import { getPublicWatchSession, getResolvedWatchSession } from '@/lib/watch-request-service';
import { GET as getYoutubeHls } from '../../../youtube/hls/[videoId]/[file]/route';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function getRequestBaseUrl(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const proto = forwardedProto || url.protocol.replace(':', '');
  const host = forwardedHost || request.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const requestUrl = new URL(request.url);
  const mediaVideoId = requestUrl.searchParams.get('mediaVideoId');
  const mediaFile = requestUrl.searchParams.get('mediaFile');

  // Discord's Activity proxy permits the session-state route but returns its
  // own 404 for the dedicated HLS routes. Tunnel Activity media through this
  // proven same-origin route and keep every segment on it as well.
  if (mediaVideoId && mediaFile) {
    const mediaResponse = await getYoutubeHls(request, {
      params: Promise.resolve({ videoId: mediaVideoId, file: mediaFile }),
    });

    if (mediaFile === 'index.m3u8' && mediaResponse.ok) {
      const manifest = await mediaResponse.text();
      const statePath = `/api/watch/sessions/${encodeURIComponent(sessionId)}/state`;
      const rewritten = manifest
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          const segmentUrl = new URL(trimmed, 'https://activity.invalid');
          const params = new URLSearchParams({
            mediaVideoId,
            mediaFile: segmentUrl.pathname.replace(/^\//, ''),
          });
          const machine = segmentUrl.searchParams.get('machine');
          if (machine) params.set('machine', machine);
          return `${statePath}?${params.toString()}`;
        })
        .join('\n');
      const headers = new Headers(mediaResponse.headers);
      headers.delete('content-length');
      headers.set('content-type', 'application/vnd.apple.mpegurl; charset=utf-8');
      return new NextResponse(rewritten, { status: mediaResponse.status, headers });
    }

    return mediaResponse;
  }

  return NextResponse.json(getPublicWatchSession(getResolvedWatchSession(sessionId), getRequestBaseUrl(request)), {
    headers: CORS_HEADERS,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
