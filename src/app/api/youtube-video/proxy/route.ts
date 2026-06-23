import { NextRequest, NextResponse } from 'next/server';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { isValidVideoId } from '@/lib/validate-video-id';

type ExtractedMedia = {
  url: string;
  mimeType: string | null;
  expires: number;
};

const extractedUrls = new Map<string, ExtractedMedia>();
const ALLOWED_BASE_HOSTS = ['googlevideo.com', 'youtube.com', 'ytimg.com'];
const RESPONSE_CHUNK_SIZE = 512 * 1024;
const UPSTREAM_QUERY_CHUNK_SIZE = 64 * 1024;

function cacheKey(videoId: string, media: 'audio' | 'video') {
  return `${media}:${videoId}`;
}

function normalizeContentType(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.split(';')[0].trim().toLowerCase();
}

function isAudioMime(value: unknown): boolean {
  return normalizeContentType(value).startsWith('audio/');
}

function isVideoMime(value: unknown): boolean {
  return normalizeContentType(value).startsWith('video/');
}

function isAllowedYoutubeMediaUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_BASE_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
}

function getMimeFromUrl(raw: string): string {
  try {
    return new URL(raw).searchParams.get('mime') || '';
  } catch {
    return '';
  }
}

function getContentLengthFromUrl(raw: string): number | null {
  try {
    const clen = new URL(raw).searchParams.get('clen');
    if (!clen) return null;
    const parsed = Number(clen);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function parseRequestedRange(rangeHeader: string | null, totalLength: number | null): { start: number; end: number } {
  if (!rangeHeader) {
    return { start: 0, end: Math.min((totalLength || RESPONSE_CHUNK_SIZE) - 1, RESPONSE_CHUNK_SIZE - 1) };
  }

  const match = /^bytes=(\d+)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return { start: 0, end: Math.min((totalLength || RESPONSE_CHUNK_SIZE) - 1, RESPONSE_CHUNK_SIZE - 1) };

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : start + RESPONSE_CHUNK_SIZE - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
    return { start: 0, end: Math.min((totalLength || RESPONSE_CHUNK_SIZE) - 1, RESPONSE_CHUNK_SIZE - 1) };
  }

  const cappedEnd = Math.min(requestedEnd, start + RESPONSE_CHUNK_SIZE - 1);
  const end = totalLength ? Math.min(cappedEnd, totalLength - 1) : cappedEnd;
  return { start, end };
}

function parseContentRange(value: string | null): { total: number | null } | null {
  if (!value) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
  if (!match) return null;
  const total = match[3] === '*' ? null : Number(match[3]);
  return total && Number.isSafeInteger(total) ? { total } : { total: null };
}

async function extract(videoId: string, media: 'audio' | 'video'): Promise<ExtractedMedia | null> {
  const key = cacheKey(videoId, media);
  const cached = extractedUrls.get(key);
  if (cached && cached.expires > Date.now() && isAllowedYoutubeMediaUrl(cached.url)) return cached;
  extractedUrls.delete(key);

  const workerUrl = getDjWorkerUrl();
  if (!workerUrl) return null;

  let data: any = null;
  try {
    const res = await fetch(`${workerUrl}/extract?videoId=${encodeURIComponent(videoId)}&mode=${media}`, { cache: 'no-store' });
    data = await res.json().catch(() => null);
    if (!res.ok || !data?.url || !isAllowedYoutubeMediaUrl(data.url)) return null;
  } catch (error: any) {
    console.warn(`[YouTube ${media} proxy] Worker extract failed for ${videoId}:`, error?.message || error);
    return null;
  }

  const mimeType = data.mimeType || getMimeFromUrl(data.url) || null;
  if (media === 'video' && isAudioMime(mimeType)) return null;
  if (media === 'audio' && isVideoMime(mimeType)) return null;

  const info = {
    url: data.url,
    mimeType,
    expires: Date.now() + 5 * 60 * 60 * 1000,
  };
  extractedUrls.set(key, info);
  return info;
}

async function fetchMediaRange(
  upstreamUrl: string,
  start: number,
  end: number,
): Promise<{ body: Uint8Array; contentType: string | null; totalLength: number | null }> {
  const chunks: Uint8Array[] = [];
  let contentType: string | null = null;
  let totalLength = getContentLengthFromUrl(upstreamUrl);
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Referer: 'https://www.youtube.com/',
    Origin: 'https://www.youtube.com',
    'Accept-Encoding': 'identity',
  };

  for (let offset = start; offset <= end; offset += UPSTREAM_QUERY_CHUNK_SIZE) {
    const chunkEnd = Math.min(end, offset + UPSTREAM_QUERY_CHUNK_SIZE - 1);
    const chunkUrl = new URL(upstreamUrl);
    chunkUrl.searchParams.set('range', `${offset}-${chunkEnd}`);
    const res = await fetch(chunkUrl, { headers });
    if (!res.ok) throw new Error(`CDN chunk fetch failed (${res.status})`);
    contentType ||= res.headers.get('content-type');
    const contentRange = parseContentRange(res.headers.get('content-range'));
    if (!totalLength && contentRange?.total) totalLength = contentRange.total;
    chunks.push(new Uint8Array(await res.arrayBuffer()));
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const body = new Uint8Array(total);
  let writeOffset = 0;
  for (const chunk of chunks) {
    body.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }

  return { body, contentType, totalLength };
}

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get('videoId');
  const media = req.nextUrl.searchParams.get('media') === 'audio' ? 'audio' : 'video';
  if (!isValidVideoId(videoId)) return new NextResponse('invalid videoId', { status: 400 });

  const extracted = await extract(videoId, media);
  if (!extracted?.url) return new NextResponse(`No ${media} URL resolved for this video`, { status: 404 });

  try {
    const totalLength = getContentLengthFromUrl(extracted.url);
    const { start, end } = parseRequestedRange(req.headers.get('range'), totalLength);
    const { body, contentType: cdnContentType, totalLength: resolvedTotalLength } = await fetchMediaRange(extracted.url, start, end);
    const queryMimeType = getMimeFromUrl(extracted.url);
    if (media === 'video' && isAudioMime(cdnContentType || queryMimeType)) {
      extractedUrls.delete(cacheKey(videoId, media));
      return new NextResponse('Resolved URL is not a video stream', { status: 415 });
    }
    if (media === 'audio' && isVideoMime(cdnContentType || queryMimeType)) {
      extractedUrls.delete(cacheKey(videoId, media));
      return new NextResponse('Resolved URL is not an audio stream', { status: 415 });
    }
    if (!resolvedTotalLength) return new NextResponse('Proxy could not determine media length', { status: 502 });

    const responseHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(body.byteLength),
      'Content-Range': `bytes ${start}-${start + body.byteLength - 1}/${resolvedTotalLength}`,
      'Content-Type': cdnContentType || extracted.mimeType || queryMimeType || (media === 'audio' ? 'audio/mp4' : 'video/mp4'),
    };

    return new NextResponse(Buffer.from(body), {
      status: 206,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error(`[YouTube ${media} proxy] Error for ${videoId}:`, error.message);
    return new NextResponse('Proxy error', { status: 500 });
  }
}
