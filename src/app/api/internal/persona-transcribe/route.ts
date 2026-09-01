import { NextRequest, NextResponse } from 'next/server';

const STREAMWEAVER_BASE_URL = String(
  process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev',
).replace(/\/$/, '');

const MAX_AUDIO_BASE64_LENGTH = 16_000_000;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as any;
  const base64Audio = String(body?.base64Audio || '').trim();
  if (!base64Audio) {
    return NextResponse.json({ error: 'base64Audio is required' }, { status: 400 });
  }
  if (base64Audio.length > MAX_AUDIO_BASE64_LENGTH) {
    return NextResponse.json({ error: 'Recorded audio is too large' }, { status: 413 });
  }

  // Public room speech is intentionally not gated by SPMT authentication.
  // Authentication already happens at the product/room boundary; talking to an
  // invited public persona is ordinary room interaction, not an account action.
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
