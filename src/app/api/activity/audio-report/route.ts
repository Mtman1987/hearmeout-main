import { NextResponse } from 'next/server';
import { isPublicActivityRequest } from '@/lib/activity-access';

let windowStarted = 0;
let reports = 0;

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!isPublicActivityRequest(url, 'POST')) return NextResponse.json({ error: 'Shared Activity required' }, { status: 403 });
  if (Number(request.headers.get('content-length') || 0) > 4096) return new Response(null, { status: 413 });
  const now = Date.now();
  if (now - windowStarted >= 60000) { windowStarted = now; reports = 0; }
  if (++reports > 120) return new Response(null, { status: 429 });
  const text = await request.text();
  if (text.length > 4096) return new Response(null, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return new Response(null, { status: 400 });
  const report: Record<string, unknown> = { sessionId: url.searchParams.get('sessionId') };
  for (const key of ['version', 'event', 'detail', 'platform', 'userAgent', 'context']) {
    if (typeof body[key] === 'string') report[key] = body[key].slice(0, key === 'userAgent' ? 300 : 200).replace(/[\r\n]/g, ' ');
  }
  for (const key of ['volume', 'readyState', 'currentTime', 'decodedAudioBytes', 'audioTracks', 'audioTrack', 'mediaError']) {
    if (typeof body[key] === 'number' && Number.isFinite(body[key])) report[key] = body[key];
  }
  for (const key of ['muted', 'paused', 'routedThroughGain', 'autoplayAllowed']) {
    if (typeof body[key] === 'boolean') report[key] = body[key];
  }
  console.info('[activity-audio]', JSON.stringify(report));
  return new Response(null, { status: 204 });
}
