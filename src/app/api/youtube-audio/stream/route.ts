import { NextRequest, NextResponse } from 'next/server';
import { isValidVideoId } from '@/lib/validate-video-id';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';

const DJ_WORKER_URL = getDjWorkerUrl();
const RESPONSE_CHUNK_SIZE = 256 * 1024;
const UPSTREAM_QUERY_CHUNK_SIZE = 16 * 1024;
const ALLOWED_AUDIO_HOSTS = ['googlevideo.com', 'youtube.com', 'ytimg.com'];

function isAllowedAudioUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_AUDIO_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
  } catch {
    return false;
  }
}

function getMimeFromUrl(raw: string): string {
  try {
    return new URL(raw).searchParams.get('mime') || '';
  } catch {
    return '';
  }
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
  if (!match) {
    return { start: 0, end: Math.min((totalLength || RESPONSE_CHUNK_SIZE) - 1, RESPONSE_CHUNK_SIZE - 1) };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : start + RESPONSE_CHUNK_SIZE - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
    return { start: 0, end: Math.min((totalLength || RESPONSE_CHUNK_SIZE) - 1, RESPONSE_CHUNK_SIZE - 1) };
  }

  const cappedEnd = Math.min(requestedEnd, start + RESPONSE_CHUNK_SIZE - 1);
  return { start, end: totalLength ? Math.min(cappedEnd, totalLength - 1) : cappedEnd };
}

function parseContentRange(value: string | null): { total: number | null } | null {
  if (!value) return null;
  const match = /^bytes\s+\d+-\d+\/(\d+|\*)$/i.exec(value.trim());
  if (!match) return null;
  const total = match[1] === '*' ? null : Number(match[1]);
  return total && Number.isSafeInteger(total) ? { total } : { total: null };
}

async function fetchAudioRange(upstreamUrl: string, start: number, end: number) {
  const chunks: Uint8Array[] = [];
  let contentType: string | null = null;
  let totalLength = getContentLengthFromUrl(upstreamUrl);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.youtube.com/',
    'Origin': 'https://www.youtube.com',
    'Accept-Encoding': 'identity',
  };

  for (let offset = start; offset <= end; offset += UPSTREAM_QUERY_CHUNK_SIZE) {
    const chunkEnd = Math.min(end, offset + UPSTREAM_QUERY_CHUNK_SIZE - 1);
    const chunkUrl = new URL(upstreamUrl);
    chunkUrl.searchParams.set('range', `${offset}-${chunkEnd}`);
    const res = await fetch(chunkUrl, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`CDN chunk fetch failed (${res.status}) for ${offset}-${chunkEnd}`);
    contentType ||= res.headers.get('content-type');
    const contentRange = parseContentRange(res.headers.get('content-range'));
    if (!totalLength && contentRange?.total) totalLength = contentRange.total;
    chunks.push(new Uint8Array(await res.arrayBuffer()));
  }

  const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const body = new Uint8Array(byteLength);
  let writeOffset = 0;
  for (const chunk of chunks) {
    body.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }

  return { body, contentType, totalLength };
}

async function streamExtractedAudio(videoId: string, req: NextRequest, requestId: string): Promise<NextResponse | null> {
  if (!DJ_WORKER_URL) return null;
  const extractRes = await fetch(
    `${DJ_WORKER_URL}/extract?videoId=${encodeURIComponent(videoId)}`,
    { signal: AbortSignal.timeout(45_000) }
  );
  if (!extractRes.ok) {
    console.warn('[AudioStream] worker extract failed', { requestId, videoId, status: extractRes.status });
    return null;
  }

  const extracted = await extractRes.json().catch(() => null);
  const audioUrl = extracted?.url;
  if (!isAllowedAudioUrl(audioUrl)) {
    console.warn('[AudioStream] worker returned invalid audio URL', { requestId, videoId });
    return null;
  }

  const queryMimeType = getMimeFromUrl(audioUrl);
  const extractedMimeType = typeof extracted?.mimeType === 'string' ? extracted.mimeType : null;
  if (isVideoMime(queryMimeType) || isVideoMime(extractedMimeType)) {
    console.warn('[AudioStream] worker returned video URL instead of audio URL', { requestId, videoId });
    return null;
  }

  const totalLength = getContentLengthFromUrl(audioUrl);
  const { start, end } = parseRequestedRange(req.headers.get('range'), totalLength);
  const { body, contentType, totalLength: resolvedTotalLength } = await fetchAudioRange(audioUrl, start, end);
  const finalTotalLength = resolvedTotalLength || totalLength;
  if (!finalTotalLength) {
    console.warn('[AudioStream] could not determine extracted audio length', { requestId, videoId });
    return null;
  }

  const ct = isAudioMime(contentType) ? contentType : (isAudioMime(extractedMimeType) ? extractedMimeType : (isAudioMime(queryMimeType) ? queryMimeType : 'audio/mp4'));
  return new NextResponse(Buffer.from(body), {
    status: 206,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'Content-Type': ct,
      'Content-Length': String(body.byteLength),
      'Content-Range': `bytes ${start}-${start + body.byteLength - 1}/${finalTotalLength}`,
    },
  });
}

// GET: Stream audio — proxied from the DJ worker or direct YouTube URL
export async function GET(req: NextRequest) {
  const videoId = new URL(req.url).searchParams.get('videoId');
  if (!videoId) return new NextResponse('videoId required', { status: 400 });
  if (!isValidVideoId(videoId)) return new NextResponse('Invalid video ID', { status: 400 });
  const requestId = Math.random().toString(36).slice(2, 8);

  // Try worker stream first
  if (DJ_WORKER_URL) {
    try {
      const headers: Record<string, string> = {};
      const rangeHeader = req.headers.get('range');
      if (rangeHeader) headers['Range'] = rangeHeader;

      const workerRes = await fetch(
        `${DJ_WORKER_URL}/stream?videoId=${encodeURIComponent(videoId)}`,
        { headers, signal: AbortSignal.timeout(10000) }
      );

      if (workerRes.ok || workerRes.status === 206) {
        console.log('[AudioStream] worker stream OK', { requestId, videoId, status: workerRes.status });
        const h: Record<string, string> = { 'Accept-Ranges': 'bytes' };
        const ct = workerRes.headers.get('content-type');
        if (ct) h['Content-Type'] = ct;
        const cl = workerRes.headers.get('content-length');
        if (cl) h['Content-Length'] = cl;
        const cr = workerRes.headers.get('content-range');
        if (cr) h['Content-Range'] = cr;
        return new NextResponse(workerRes.body, { status: workerRes.status, headers: h });
      }
    } catch (err: any) {
      console.warn(`[AudioStream] Worker unavailable: ${err.message}`);
    }

    try {
      const extracted = await streamExtractedAudio(videoId, req, requestId);
      if (extracted) return extracted;
    } catch (err: any) {
      console.warn('[AudioStream] Worker extract fallback unavailable:', err?.message || err);
    }
  }

  console.error(`[AudioStream] Worker stream unavailable`, { requestId, videoId });
  return new NextResponse('Worker stream unavailable', { status: 503 });
}
