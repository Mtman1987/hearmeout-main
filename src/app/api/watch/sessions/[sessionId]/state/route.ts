import { NextResponse } from 'next/server';
import { getPublicWatchSession, getResolvedWatchSession } from '@/lib/watch-request-service';
import { getMediaWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';
import { isValidVideoId } from '@/lib/validate-video-id';
import { GET as getYoutubeHls } from '../../../youtube/hls/[videoId]/[file]/route';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, range',
};

function getRequestBaseUrl(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const proto = forwardedProto || url.protocol.replace(':', '');
  const host = forwardedHost || request.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

function copyMediaHeaders(source: Headers) {
  const headers = new Headers(CORS_HEADERS);
  for (const header of [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
    'etag',
    'last-modified',
  ]) {
    const value = source.get(header);
    if (value) headers.set(header, value);
  }
  return headers;
}

async function proxyDiscordYoutubeAudio(request: Request, videoId: string) {
  const workerUrl = getMediaWorkerUrl(request);
  if (!workerUrl || !isValidVideoId(videoId)) return null;
  // YouTube URLs are tied to the extractor's network address. The worker that
  // resolves the source must also stream it; the web app forwards only bytes.
  const headers = getDjWorkerRequestHeaders({ 'user-agent': 'HearMeOut/1.0' });
  const range = request.headers.get('range');
  if (range) headers.set('range', range);
  const response = await fetch(workerUrl + '/watch/youtube/discord-audio/' + encodeURIComponent(videoId) + '/stream', {
    headers, cache: 'no-store', signal: AbortSignal.timeout(45000),
  }).catch(() => null);
  if (!response?.ok) { void response?.body?.cancel().catch(() => {}); return null; }
  const mediaHeaders = copyMediaHeaders(response.headers);
  mediaHeaders.set('cache-control', 'no-store');
  return new NextResponse(response.body, { status: response.status, headers: mediaHeaders });
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
    if (mediaFile === 'source.webm') {
      if (!isValidVideoId(mediaVideoId)) return NextResponse.json({ error: 'Invalid video id' }, { status: 400, headers: CORS_HEADERS });
      const stream = await proxyDiscordYoutubeAudio(request, mediaVideoId);
      return stream || NextResponse.json({ error: 'Song audio unavailable. Try Next or another song.' }, { status: 503, headers: CORS_HEADERS });
    }
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
          if (requestUrl.searchParams.get('lane') === 'activity') params.set('lane', 'activity');
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

  const session = getResolvedWatchSession(sessionId);
  // A catalog runtime is not proof that playback finished: buffering and
  // stalled video consume wall-clock time. The Lounge source advances only
  // after its media element reports that the current item actually ended.
  return NextResponse.json(getPublicWatchSession(session, getRequestBaseUrl(request)), {
    headers: CORS_HEADERS,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
