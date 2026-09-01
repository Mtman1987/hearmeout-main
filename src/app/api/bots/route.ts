import { NextResponse } from 'next/server';

const STREAMWEAVER_BASE_URL = String(
  process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev',
).replace(/\/$/, '');

export async function GET() {
  const upstream = await fetch(`${STREAMWEAVER_BASE_URL}/api/internal/hearmeout/bots`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(12000) : undefined,
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json({ error: 'Persona catalog is unavailable' }, { status: 502 });
  }

  const raw = await upstream.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || 'Invalid StreamWeaver response' }; }

  return NextResponse.json(payload, {
    status: upstream.status,
    headers: { 'cache-control': 'public, max-age=0, no-store' },
  });
}
