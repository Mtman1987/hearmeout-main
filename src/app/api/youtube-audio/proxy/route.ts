import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isValidVideoId } from '@/lib/validate-video-id';

// In-memory store of client-extracted URLs (videoId → directUrl)
// These are extracted by the DJ's browser and sent here for proxying.
const extractedUrls = new Map<string, { url: string; expires: number }>();

// Allowed host suffixes for the upstream audio URL. Anything else is rejected
// so this endpoint can't be abused as a generic SSRF primitive
// (e.g. against 169.254.169.254, localhost, internal services, etc).
const ALLOWED_HOST_SUFFIXES = [
  '.googlevideo.com',
  '.youtube.com',
  'youtube.com',
  '.ytimg.com',
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
  return ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(s));
}

// POST: Client sends an extracted googlevideo URL for a video.
// Requires an authenticated session AND a whitelisted host on `audioUrl`.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const videoId = body?.videoId;
  const audioUrl = body?.audioUrl;

  if (!isValidVideoId(videoId)) {
    return NextResponse.json({ error: 'invalid videoId' }, { status: 400 });
  }
  if (!isAllowedAudioUrl(audioUrl)) {
    return NextResponse.json({ error: 'audioUrl must be an https URL on a YouTube CDN' }, { status: 400 });
  }

  // Cache for 5 hours (URLs expire in ~6)
  extractedUrls.set(videoId, { url: audioUrl, expires: Date.now() + 5 * 60 * 60 * 1000 });
  console.log(`[Proxy] Registered URL for ${videoId} by ${session.uid}`);

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
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.youtube.com/',
      'Origin': 'https://www.youtube.com',
    };
    if (rangeHeader) headers['Range'] = rangeHeader;

    const cdnRes = await fetch(cached.url, { headers });

    if (!cdnRes.ok && cdnRes.status !== 206) {
      console.error(`[Proxy] CDN fetch failed for ${videoId}: ${cdnRes.status}`);
      extractedUrls.delete(videoId);
      return new NextResponse('CDN fetch failed', { status: 502 });
    }

    const responseHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'Accept-Ranges': 'bytes',
    };

    const ct = cdnRes.headers.get('content-type');
    if (ct) responseHeaders['Content-Type'] = ct;
    const cl = cdnRes.headers.get('content-length');
    if (cl) responseHeaders['Content-Length'] = cl;
    const cr = cdnRes.headers.get('content-range');
    if (cr) responseHeaders['Content-Range'] = cr;

    return new NextResponse(cdnRes.body, {
      status: cdnRes.status,
      headers: responseHeaders,
    });
  } catch (err: any) {
    console.error(`[Proxy] Error for ${videoId}:`, err.message);
    return new NextResponse('Proxy error', { status: 500 });
  }
}
