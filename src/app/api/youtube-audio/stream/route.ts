import { NextRequest, NextResponse } from 'next/server';
import { isValidVideoId } from '@/lib/validate-video-id';
import { getDjWorkerSecret, getDjWorkerUrl } from '@/lib/dj-worker-config';
import { extractAudioUrlWithReason } from '@/lib/yt-extract';

const DJ_WORKER_URL = getDjWorkerUrl();
const DJ_WORKER_SECRET = getDjWorkerSecret();

// GET: Stream audio — proxied from the DJ worker or direct YouTube URL
export async function GET(req: NextRequest) {
  const videoId = new URL(req.url).searchParams.get('videoId');
  if (!videoId) return new NextResponse('videoId required', { status: 400 });
  if (!isValidVideoId(videoId)) return new NextResponse('Invalid video ID', { status: 400 });
  const requestId = Math.random().toString(36).slice(2, 8);

  // Try worker stream first
  if (DJ_WORKER_URL) {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${DJ_WORKER_SECRET}`,
      };
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
      console.warn(`[AudioStream] Worker unavailable: ${err.message}, trying local extract`);
    }
  }

  // Fallback: extract URL locally and proxy it
  try {
    const result = await extractAudioUrlWithReason(videoId);
    if (!result.audio?.url) {
      return new NextResponse(`Extraction failed: ${result.reason || 'unknown'}`, { status: 404 });
    }

    const headers: Record<string, string> = {};
    const rangeHeader = req.headers.get('range');
    if (rangeHeader) headers['Range'] = rangeHeader;

    const audioRes = await fetch(result.audio.url, { headers, signal: AbortSignal.timeout(30000) });
    if (!audioRes.ok && audioRes.status !== 206) {
      return new NextResponse('Audio fetch failed', { status: audioRes.status });
    }

    const h: Record<string, string> = { 'Accept-Ranges': 'bytes' };
    const ct = audioRes.headers.get('content-type');
    if (ct) h['Content-Type'] = ct;
    const cl = audioRes.headers.get('content-length');
    if (cl) h['Content-Length'] = cl;
    const cr = audioRes.headers.get('content-range');
    if (cr) h['Content-Range'] = cr;

    console.log('[AudioStream] local proxy OK', { requestId, videoId, status: audioRes.status });
    return new NextResponse(audioRes.body, { status: audioRes.status, headers: h });
  } catch (err: any) {
    console.error(`[AudioStream] All methods failed`, { requestId, videoId, message: err.message });
    return new NextResponse('Stream error', { status: 500 });
  }
}
