import { NextRequest, NextResponse } from 'next/server';
import { isValidVideoId } from '@/lib/validate-video-id';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const videoId = url.searchParams.get('videoId');
  const roomId = url.searchParams.get('roomId');
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 });
  if (!isValidVideoId(videoId)) return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });

  const workerUrl = getDjWorkerUrl();
  if (!workerUrl) {
    return NextResponse.json({ error: 'DJ worker not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(
      `${workerUrl}/extract?videoId=${encodeURIComponent(videoId)}${roomId ? `&roomId=${encodeURIComponent(roomId)}` : ''}`,
    );
    const data = await res.json().catch(() => ({ error: `Worker returned ${res.status}` }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
