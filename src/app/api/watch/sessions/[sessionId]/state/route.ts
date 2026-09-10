import { NextResponse } from 'next/server';
import { getPublicWatchSession, getResolvedWatchSession } from '@/lib/watch-request-service';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
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

async function extractYoutubeAudio(videoId: string, refresh = false) {
  const workerUrl = getDjWorkerUrl();
  if (!workerUrl || !isValidVideoId(videoId)) return null;

  const url = new URL(`${workerUrl}/extract`);
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('mode', 'audio');
  if (refresh) url.searchParams.set('refresh', '1');

  const response = await fetch(url, {
    headers: getDjWorkerRequestHeaders({ 'user-agent': 'HearMeOut/1.0' }),
    cache: 'no-store',
  }).catch(() => null);
  if (!response?.ok) return null;

  const payload = await response.json().catch(() => null) as { url?: string; mimeType?: string } | null;
  if (!payload?.url || !/^https:\/\//i.test(payload.url)) return null;
  return payload;
}

async function proxyDiscordYoutubeAudio(request: Request, videoId: string) {
  let extracted = await extractYoutubeAudio(videoId, false);
  if (!extracted) return null;

  const fetchMedia = async (url: string) => {
    const headers = new Headers({
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      referer: 'https://www.youtube.com/',
      origin: 'https://www.youtube.com',
      accept: '*/*',
    });
    const range = request.headers.get('range');
    if (range) headers.set('range', range);
    return fetch(url, { headers, redirect: 'follow', cache: 'no-store' }).catch(() => null);
  };

  let mediaResponse = await fetchMedia(extracted.url!);
  if (mediaResponse && (mediaResponse.status === 401 || mediaResponse.status === 403)) {
    extracted = await extractYoutubeAudio(videoId, true);
    if (extracted?.url) mediaResponse = await fetchMedia(extracted.url);
  }
  if (!mediaResponse?.ok && mediaResponse?.status !== 206) return null;

  const headers = copyMediaHeaders(mediaResponse.headers);
  if (!headers.get('content-type') && extracted?.mimeType) headers.set('content-type', extracted.mimeType);
  headers.set('cache-control', 'no-store');
  return new NextResponse(mediaResponse.body, {
    status: mediaResponse.status,
    headers,
  });
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

    // The HearMeOut web player can already be playing from the prepared HLS
    // stream while the separately cached audio file does not exist yet. The
    // Discord Activity intentionally asks for source.webm because Discord's
    // Electron media stack rejects the AAC MPEG-TS rendition. Do not turn that
    // cache miss into a dead Activity: resolve the same song's audio stream and
    // proxy it through this allowed same-origin route instead.
    if (mediaFile === 'source.webm' && !mediaResponse.ok && [404, 502, 503].includes(mediaResponse.status)) {
      const fallback = await proxyDiscordYoutubeAudio(request, mediaVideoId);
      if (fallback) return fallback;
    }

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
