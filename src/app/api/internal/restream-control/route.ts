import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOUNGE_WORKER_URL = String(
  process.env.LOUNGE_WORKER_URL || 'http://hmo-lounge-worker.internal:3002',
).replace(/\/$/, '');

function safeEqual(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: NextRequest) {
  const expected = String(process.env.SPMT_API_KEY || process.env.SPMT_PLATFORM_API_KEY || '').trim();
  const supplied = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return Boolean(expected && supplied && safeEqual(supplied, expected));
}

async function callWorker(path: string, init?: RequestInit) {
  try {
    const response = await fetch(`${LOUNGE_WORKER_URL}${path}`, {
      ...init,
      headers: getDjWorkerRequestHeaders({
        accept: 'application/json',
        'content-type': 'application/json',
        ...(init?.headers || {}),
      }),
      cache: 'no-store',
      signal: init?.signal || AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 502, body: { error: 'Lounge Restream controller is unreachable' } };
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await callWorker('/restream/status');
  return NextResponse.json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (String(body?.action || '') !== 'reset') {
    return NextResponse.json({ error: 'Only the controlled reset action is supported' }, { status: 400 });
  }
  const holdMs = Math.max(5000, Math.min(Number(body?.holdMs || 15000), 30000));
  const result = await callWorker('/restream/reset', {
    method: 'POST',
    body: JSON.stringify({ holdMs }),
    signal: AbortSignal.timeout(120000),
  });
  return NextResponse.json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } });
}
