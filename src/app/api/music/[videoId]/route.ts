import { NextRequest, NextResponse } from 'next/server';
import { isValidVideoId } from '@/lib/validate-video-id';
import { getDjWorkerSecret, getDjWorkerUrl } from '@/lib/dj-worker-config';

const DJ_WORKER_URL = getDjWorkerUrl();
const DJ_WORKER_SECRET = getDjWorkerSecret();

export async function GET(req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  const requestId = Math.random().toString(36).slice(2, 8);
  if (!isValidVideoId(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
  }

  if (!DJ_WORKER_URL) return new NextResponse('Worker not configured', { status: 503 });

  try {
    const workerRes = await fetch(`${DJ_WORKER_URL}/music/${videoId}`, {
      headers: { Authorization: `Bearer ${DJ_WORKER_SECRET}` },
    });
    console.log('[MusicProxy] worker response', { requestId, videoId, status: workerRes.status });

    if (!workerRes.ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const h: Record<string, string> = {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=604800',
      'Accept-Ranges': 'bytes',
    };
    const cl = workerRes.headers.get('content-length');
    if (cl) h['Content-Length'] = cl;

    return new NextResponse(workerRes.body, { headers: h });
  } catch (err: any) {
    console.error('[MusicProxy] worker proxy error', { requestId, videoId, message: err.message });
    return NextResponse.json({ error: 'Stream error' }, { status: 500 });
  }
}
