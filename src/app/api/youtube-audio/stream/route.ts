import { NextRequest, NextResponse } from 'next/server';
import { extractAudioUrl } from '@/lib/yt-extract';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getExtractedUrl, setExtractedUrl, deleteExtractedUrl } from '@/lib/audio-url-cache';

const CACHE_DIR = process.env.MUSIC_CACHE_DIR || join(process.cwd(), 'data', 'music');

// GET: Stream audio from CDN through our server (same-origin proxy)
export async function GET(req: NextRequest) {
  const videoId = new URL(req.url).searchParams.get('videoId');
  if (!videoId) return new NextResponse('videoId required', { status: 400 });

  // Serve cached mp3 if available
  const mp3Path = join(CACHE_DIR, `${videoId}.mp3`);
  if (existsSync(mp3Path)) {
    const data = readFileSync(mp3Path);
    return new NextResponse(data, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': data.length.toString(),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  // Get or extract URL
  let audioUrl = getExtractedUrl(videoId);
  if (!audioUrl) {
    const extracted = await extractAudioUrl(videoId);
    if (!extracted) return new NextResponse('Extraction failed', { status: 404 });
    audioUrl = extracted.url;
    setExtractedUrl(videoId, audioUrl);
  }

  // Proxy from CDN
  try {
    const rangeHeader = req.headers.get('range');
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.youtube.com/',
    };
    if (rangeHeader) headers['Range'] = rangeHeader;

    const cdnRes = await fetch(audioUrl, { headers });

    if (!cdnRes.ok && cdnRes.status !== 206) {
      // URL expired, try fresh extraction
      deleteExtractedUrl(videoId);
      const fresh = await extractAudioUrl(videoId);
      if (!fresh) return new NextResponse('CDN fetch failed', { status: 502 });
      setExtractedUrl(videoId, fresh.url);

      const retryRes = await fetch(fresh.url, { headers });
      if (!retryRes.ok && retryRes.status !== 206) {
        return new NextResponse('CDN fetch failed after retry', { status: 502 });
      }
      return proxyResponse(retryRes);
    }

    return proxyResponse(cdnRes);
  } catch (err: any) {
    console.error(`[stream] Proxy error for ${videoId}:`, err.message);
    return new NextResponse('Stream error', { status: 500 });
  }
}

function proxyResponse(cdnRes: Response): NextResponse {
  const h: Record<string, string> = { 'Accept-Ranges': 'bytes' };
  const ct = cdnRes.headers.get('content-type');
  if (ct) h['Content-Type'] = ct;
  const cl = cdnRes.headers.get('content-length');
  if (cl) h['Content-Length'] = cl;
  const cr = cdnRes.headers.get('content-range');
  if (cr) h['Content-Range'] = cr;
  return new NextResponse(cdnRes.body, { status: cdnRes.status, headers: h });
}
