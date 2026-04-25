import { NextRequest, NextResponse } from 'next/server';

// In-memory store of client-extracted URLs (videoId → directUrl)
// These are extracted by the DJ's browser and sent here for proxying
const extractedUrls = new Map<string, { url: string; expires: number }>();

// POST: Client sends an extracted googlevideo URL for a video
export async function POST(req: NextRequest) {
  const { videoId, audioUrl } = await req.json();
  if (!videoId || !audioUrl) {
    return NextResponse.json({ error: 'videoId and audioUrl required' }, { status: 400 });
  }

  // Cache for 5 hours (URLs expire in ~6)
  extractedUrls.set(videoId, { url: audioUrl, expires: Date.now() + 5 * 60 * 60 * 1000 });
  console.log(`[Proxy] Registered URL for ${videoId}`);

  return NextResponse.json({ proxyUrl: `/api/youtube-audio/proxy?videoId=${videoId}` });
}

// GET: Proxy the audio from googlevideo CDN
export async function GET(req: NextRequest) {
  const videoId = new URL(req.url).searchParams.get('videoId');
  if (!videoId) return new NextResponse('videoId required', { status: 400 });

  const cached = extractedUrls.get(videoId);
  if (!cached || cached.expires < Date.now()) {
    return new NextResponse('No URL registered for this video', { status: 404 });
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
