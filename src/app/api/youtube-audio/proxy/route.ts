import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isValidVideoId } from '@/lib/validate-video-id';

// In-memory store of client-extracted URLs (videoId → directUrl)
// These are extracted by the DJ's browser and sent here for proxying.
const extractedUrls = new Map<string, { url: string; mimeType: string | null; expires: number }>();

// Allowed base hosts for the upstream audio URL. A candidate host must
// EITHER exactly equal one of these OR end with `.` + one of these — so
// `youtube.com` is allowed but `evilyoutube.com` is not. Anything else is
// rejected, so this endpoint can't be abused as a generic SSRF primitive
// (e.g. against 169.254.169.254, localhost, internal services, etc).
const ALLOWED_BASE_HOSTS = [
  'googlevideo.com',
  'youtube.com',
  'ytimg.com',
];

function isAllowedAudioUrl(raw: unknown): raw is string {
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

const RESPONSE_CHUNK_SIZE = 256 * 1024;
const UPSTREAM_QUERY_CHUNK_SIZE = 16 * 1024;

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
  const end = totalLength ? Math.min(cappedEnd, totalLength - 1) : cappedEnd;
  return { start, end };
}

async function fetchAudioRange(
  upstreamUrl: string,
  start: number,
  end: number,
  headers: Record<string, string>,
): Promise<{ body: Uint8Array; contentType: string | null }> {
  const chunks: Uint8Array[] = [];
  let contentType: string | null = null;

  for (let offset = start; offset <= end; offset += UPSTREAM_QUERY_CHUNK_SIZE) {
    const chunkEnd = Math.min(end, offset + UPSTREAM_QUERY_CHUNK_SIZE - 1);
    const chunkUrl = new URL(upstreamUrl);
    chunkUrl.searchParams.set('range', `${offset}-${chunkEnd}`);

    const res = await fetch(chunkUrl, { headers });
    if (!res.ok) {
      throw new Error(`CDN chunk fetch failed (${res.status}) for ${offset}-${chunkEnd}`);
    }

    contentType ||= res.headers.get('content-type');
    chunks.push(new Uint8Array(await res.arrayBuffer()));
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const body = new Uint8Array(total);
  let writeOffset = 0;
  for (const chunk of chunks) {
    body.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }

  return { body, contentType };
}

// POST: Client sends an extracted googlevideo URL for a video.
// This intentionally does not require app auth: worker-launched DJ browsers do
// not have user cookies, and SSRF is constrained by strict host validation.
export async function POST(req: NextRequest) {
  const session = await getSession();

  const body = await req.json().catch(() => null);
  const videoId = body?.videoId;
  const audioUrl = body?.audioUrl;
  const mimeType = typeof body?.mimeType === 'string' ? body.mimeType : null;

  if (!isValidVideoId(videoId)) {
    return NextResponse.json({ error: 'invalid videoId' }, { status: 400 });
  }
  if (!isAllowedAudioUrl(audioUrl)) {
    return NextResponse.json({ error: 'audioUrl must be an https URL on a YouTube CDN' }, { status: 400 });
  }

  const queryMimeType = getMimeFromUrl(audioUrl);
  if (isVideoMime(mimeType) || isVideoMime(queryMimeType)) {
    return NextResponse.json({ error: 'extracted URL is video-only; audio URL required' }, { status: 415 });
  }

  // Cache for 5 hours (URLs expire in ~6)
  extractedUrls.set(videoId, {
    url: audioUrl,
    mimeType: isAudioMime(mimeType) ? mimeType : (isAudioMime(queryMimeType) ? queryMimeType : null),
    expires: Date.now() + 5 * 60 * 60 * 1000,
  });
  console.log(`[Proxy] Registered URL for ${videoId} by ${session?.uid || 'dj-worker'}`);

  return NextResponse.json({ proxyUrl: `/api/youtube-audio/proxy?videoId=${videoId}` });
}

// GET: Proxy the audio from googlevideo CDN.
// GET stays public (listener playback), but we re-validate the stored URL's
// host before we actually fetch — so even a stale / poisoned entry can't
// cause an SSRF.
export async function GET(req: NextRequest) {
  const videoId = new URL(req.url).searchParams.get('videoId');
  if (!isValidVideoId(videoId)) {
    return new NextResponse('invalid videoId', { status: 400 });
  }

  const cached = extractedUrls.get(videoId);
  if (!cached || cached.expires < Date.now()) {
    return new NextResponse('No URL registered for this video', { status: 404 });
  }
  if (!isAllowedAudioUrl(cached.url)) {
    extractedUrls.delete(videoId);
    return new NextResponse('stored URL no longer allowed', { status: 400 });
  }

  try {
    const rangeHeader = req.headers.get('range');
    const totalLength = getContentLengthFromUrl(cached.url);
    const { start, end } = parseRequestedRange(rangeHeader, totalLength);
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.youtube.com/',
      'Origin': 'https://www.youtube.com',
      'Accept-Encoding': 'identity',
    };

    const { body, contentType: cdnContentType } = await fetchAudioRange(cached.url, start, end, headers);
    const queryMimeType = getMimeFromUrl(cached.url);
    if (isVideoMime(cdnContentType) || isVideoMime(queryMimeType)) {
      console.error(`[Proxy] Refusing non-audio CDN response for ${videoId}: ${cdnContentType || queryMimeType || 'unknown type'}`);
      extractedUrls.delete(videoId);
      return new NextResponse('Registered URL is not an audio stream', { status: 415 });
    }

    const responseHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(body.byteLength),
    };

    const ct = isAudioMime(cdnContentType) ? cdnContentType : (cached.mimeType || (isAudioMime(queryMimeType) ? queryMimeType : null));
    if (ct) responseHeaders['Content-Type'] = ct;
    if (totalLength) responseHeaders['Content-Range'] = `bytes ${start}-${start + body.byteLength - 1}/${totalLength}`;

    return new NextResponse(Buffer.from(body), {
      status: 206,
      headers: responseHeaders,
    });
  } catch (err: any) {
    console.error(`[Proxy] Error for ${videoId}:`, err.message);
    return new NextResponse('Proxy error', { status: 500 });
  }
}
