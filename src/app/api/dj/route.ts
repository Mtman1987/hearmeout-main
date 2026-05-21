import { NextRequest, NextResponse } from 'next/server';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';

async function forwardToWorker(body: Record<string, unknown>): Promise<NextResponse> {
  const url = getDjWorkerUrl();
  if (!url) {
    return NextResponse.json({ success: false, message: 'DJ worker not configured (DJ_WORKER_URL missing)' }, { status: 500 });
  }

  try {
    const res = await fetch(`${url}/dj`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ success: false, message: `Worker returned ${res.status}` }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: `Worker unreachable: ${err.message}` }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, roomId } = body;

    if (!roomId) {
      return NextResponse.json({ success: false, message: 'roomId required' }, { status: 400 });
    }
    if (!action) {
      return NextResponse.json({ success: false, message: 'action required' }, { status: 400 });
    }

    // Forward all actions (start, stop, play-url, debug-play-url) to the worker
    return forwardToWorker(body);
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const url = getDjWorkerUrl();
  if (!url) {
    return NextResponse.json({ instances: [] });
  }

  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get('roomId');

  try {
    const endpoint = roomId ? `/dj?roomId=${encodeURIComponent(roomId)}` : '/dj';
    const res = await fetch(`${url}${endpoint}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(roomId ? { running: false } : { instances: [] });
  }
}
