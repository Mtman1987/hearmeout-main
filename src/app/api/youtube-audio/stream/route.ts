import { NextRequest, NextResponse } from 'next/server';
import { extractAudioUrl } from '@/lib/yt-extract';
import { createReadStream, existsSync, statSync } from 'fs';
import type { ReadStream } from 'fs';
import { join } from 'path';

const CACHE_DIR = process.env.MUSIC_CACHE_DIR || join(process.cwd(), 'data', 'music');

// Shared URL cache
const urlCache = new Map<string, { url: string; expires: number }>();

function getUrl(videoId: string): string | null {
  const cached = urlCache.get(videoId);
  if (cached && cached.expires > Date.now()) return cached.url;
  return null;
}

// GET: Stream audio from CDN through our server (same-origin proxy)
export async function GET(req: NextRequest) {
  const videoId = new URL(req.url).searchParams.get('videoId');
  if (!videoId) return new NextResponse('videoId required', { status: 400 });

  // Serve cached mp3 if available. Stream from disk + honour Range requests
  // so HTML5 audio can seek without re-downloading the whole file and the
  // Node event loop isn't blocked synchronously reading multi-MB MP3s
  // (which used to cause audible stutter on shared rooms).
  const mp3Path = join(CACHE_DIR, `${videoId}.mp3`);
  if (existsSync(mp3Path)) {
    return serveCachedMp3(mp3Path, req.headers.get('range'));
  }

  // Get or extract URL
  let audioUrl = getUrl(videoId);
  if (!audioUrl) {
    const extracted = await extractAudioUrl(videoId);
    if (!extracted) return new NextResponse('Extraction failed', { status: 404 });
    audioUrl = extracted.url;
    urlCache.set(videoId, { url: audioUrl, expires: Date.now() + 5 * 60 * 60 * 1000 });
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
      urlCache.delete(videoId);
      const fresh = await extractAudioUrl(videoId);
      if (!fresh) return new NextResponse('CDN fetch failed', { status: 502 });
      urlCache.set(videoId, { url: fresh.url, expires: Date.now() + 5 * 60 * 60 * 1000 });

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

function serveCachedMp3(filePath: string, range: string | null): NextResponse {
  const stat = statSync(filePath);
  const size = stat.size;
  const headers: Record<string, string> = {
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
  };

  if (range) {
    // RFC 7233: support both "bytes=A-B" and the "last N bytes" suffix form
    // "bytes=-N". The previous parser treated bytes=-500 as bytes=0-500.
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const rawStart = match && match[1] !== '' ? parseInt(match[1], 10) : null;
    const rawEnd = match && match[2] !== '' ? parseInt(match[2], 10) : null;
    let start: number;
    let end: number;
    if (rawStart === null && rawEnd !== null) {
      // Suffix range: last rawEnd bytes
      start = Math.max(0, size - rawEnd);
      end = size - 1;
    } else {
      start = rawStart ?? 0;
      end = rawEnd ?? size - 1;
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
      return new NextResponse('Invalid range', {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    headers['Content-Length'] = String(end - start + 1);
    return new NextResponse(toWebStream(createReadStream(filePath, { start, end })), {
      status: 206,
      headers,
    });
  }

  headers['Content-Length'] = String(size);
  return new NextResponse(toWebStream(createReadStream(filePath)), {
    status: 200,
    headers,
  });
}

// Wrap a Node fs.ReadStream as a Web ReadableStream<Uint8Array> compatible
// with NextResponse's BodyInit type, without pulling Readable.toWeb's
// `ReadableStream<any>` (which Next 16 + TS strict mode rejects).
function toWebStream(stream: ReadStream): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on('data', (chunk) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
        controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      });
      stream.on('end', () => controller.close());
      stream.on('error', (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });
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
