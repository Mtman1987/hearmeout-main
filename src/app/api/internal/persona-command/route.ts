import { NextRequest, NextResponse } from 'next/server';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';
import { refreshHmoSpmtSession } from '@/lib/spmt-session';

const STREAMWEAVER_BASE_URL = String(
  process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev',
).replace(/\/$/, '');

function text(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max);
}

async function forward(accessToken: string, body: any) {
  const response = await fetch(`${STREAMWEAVER_BASE_URL}/api/spmt/bot/commands`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      command: text(body.command || body.transcript, 5000),
      source: 'hearmeout-persona',
      roomId: text(body.roomId, 160) || undefined,
      targetTenantId: text(body.targetTenantId, 128) || undefined,
      speak: true,
      voice: text(body.voice, 128) || undefined,
    }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(65000) : undefined,
  });
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || 'Invalid StreamWeaver response' }; }
  return { response, payload };
}

export async function POST(request: NextRequest) {
  if (!isDjWorkerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as any;
  const command = text(body?.command || body?.transcript, 5000);
  let accessToken = text(body?.accessToken, 10000);
  let refreshToken = text(body?.refreshToken, 10000);
  if (!command || !accessToken) {
    return NextResponse.json({ error: 'command and accessToken are required' }, { status: 400 });
  }

  let upstream = await forward(accessToken, { ...body, command });
  let refreshed: Awaited<ReturnType<typeof refreshHmoSpmtSession>> = null;
  if (upstream.response.status === 401 && refreshToken) {
    refreshed = await refreshHmoSpmtSession(refreshToken);
    if (refreshed) {
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      upstream = await forward(accessToken, { ...body, command });
    }
  }

  return NextResponse.json({
    ...upstream.payload,
    personaSession: {
      accessToken,
      refreshToken,
      refreshed: !!refreshed,
    },
  }, {
    status: upstream.response.status,
    headers: { 'cache-control': 'private, no-store' },
  });
}
