import { NextRequest, NextResponse } from 'next/server';
import { isValidVideoId } from '@/lib/validate-video-id';

const DJ_WORKER_URL = process.env.DJ_WORKER_URL || '';
const DJ_WORKER_SECRET = process.env.DJ_WORKER_SECRET || '';

// GET: Stream audio — proxied from the DJ worker
export async function GET(req: NextRequest) {
  const videoId = new URL(req.url).searchParams.get('videoId');
  if (!videoId) return new NextResponse('videoId required', { status: 400 });
  if (!isValidVideoId(videoId)) return new NextResponse('Invalid video ID', { status: 400 });

  if (!DJ_WORKER_URL) return new NextResponse('Worker not configured', { status: 503 });

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${DJ_WORKER_SECRET}`,
    };
    const rangeHeader = req.headers.get('range');
    if (rangeHeader) headers['Range'] = rangeHeader;

    const workerRes = await fetch(
      `${DJ_WORKER_URL}/stream?videoId=${encodeURIComponent(videoId)}`,
      { headers }
    );

    if (!workerRes.ok && workerRes.status !== 206) {
      return new NextResponse('Stream failed', { status: workerRes.status });
    }

    const h: Record<string, string> = { 'Accept-Ranges': 'bytes' };
    const ct = workerRes.headers.get('content-type');
    if (ct) h['Content-Type'] = ct;
    const cl = workerRes.headers.get('content-length');
    if (cl) h['Content-Length'] = cl;
    const cr = workerRes.headers.get('content-range');
    if (cr) h['Content-Range'] = cr;

    return new NextResponse(workerRes.body, { status: workerRes.status, headers: h });
  } catch (err: any) {
    console.error(`[stream] Worker proxy error for ${videoId}:`, err.message);
    return new NextResponse('Stream error', { status: 500 });
  }
}
