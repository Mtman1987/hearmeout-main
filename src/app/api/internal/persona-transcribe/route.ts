import { NextRequest, NextResponse } from 'next/server';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';

const STREAMWEAVER_BASE_URL = String(
  process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev',
).replace(/\/$/, '');

export async function POST(request: NextRequest) {
  if (!isDjWorkerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as any;
  const base64Audio = String(body?.base64Audio || '').trim();
  if (!base64Audio) {
    return NextResponse.json({ error: 'base64Audio is required' }, { status: 400 });
  }

  const upstream = await fetch(`${STREAMWEAVER_BASE_URL}/api/speech/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ base64Audio }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(45000) : undefined,
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json({ error: 'Speech transcription service is unavailable' }, { status: 502 });
  }
  const raw = await upstream.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || 'Invalid transcription response' }; }
  return NextResponse.json(payload, {
    status: upstream.status,
    headers: { 'cache-control': 'private, no-store' },
  });
}
