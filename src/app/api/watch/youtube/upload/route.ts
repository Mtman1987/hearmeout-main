import { NextResponse } from 'next/server';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { isValidVideoId } from '@/lib/validate-video-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 75 * 1024 * 1024;

// GET: report whether the worker already has a cached audio file for this video.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const videoId = String(url.searchParams.get('videoId') || '').trim();
  const user = String(url.searchParams.get('user') || '').trim();

  if (!isValidVideoId(videoId)) {
    return NextResponse.json({ error: 'Invalid videoId' }, { status: 400 });
  }

  const workerUrl = getDjWorkerUrl();
  if (!workerUrl) return NextResponse.json({ cached: false });

  const target = new URL(`${workerUrl}/watch/youtube/cache/${videoId}`);
  if (user) target.searchParams.set('user', user);

  try {
    const response = await fetch(target.toString(), { headers: { 'user-agent': 'HearMeOut/1.0' } });
    if (response.status === 404) return NextResponse.json({ cached: false });
    const data = await response.json().catch(() => null);
    return NextResponse.json({ cached: Boolean(data?.cached), bytes: data?.bytes });
  } catch {
    return NextResponse.json({ cached: false });
  }
}

// POST: receive audio bytes downloaded by the browser and forward them to the
// worker, which caches the file so playback never touches YouTube server-side.
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const videoId = String(url.searchParams.get('videoId') || '').trim();
    const user = String(url.searchParams.get('user') || '').trim();

    if (!isValidVideoId(videoId)) {
      return NextResponse.json({ error: 'Invalid videoId' }, { status: 400 });
    }

    const workerUrl = getDjWorkerUrl();
    if (!workerUrl) {
      return NextResponse.json({ error: 'DJ worker not configured' }, { status: 503 });
    }

    const body = await request.arrayBuffer();
    if (!body || body.byteLength === 0) {
      return NextResponse.json({ error: 'Empty audio body' }, { status: 400 });
    }
    if (body.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'Audio too large' }, { status: 413 });
    }

    const target = new URL(`${workerUrl}/watch/youtube/cache/${videoId}`);
    if (user) target.searchParams.set('user', user);

    const response = await fetch(target.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'user-agent': 'HearMeOut/1.0' },
      body,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json({ error: data?.error || 'Worker cache failed' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, videoId, bytes: data?.bytes });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Upload failed' }, { status: 500 });
  }
}
