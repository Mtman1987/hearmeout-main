import { NextRequest, NextResponse } from 'next/server';
import {
  HMO_SPMT_COOKIE,
  HMO_SPMT_REFRESH_COOKIE,
  SPMT_BASE_URL,
  hmoSpmtCookieOptions,
  refreshHmoSpmtSession,
} from '@/lib/spmt-session';

type AthenaCommandBody = {
  command?: unknown;
  message?: unknown;
  transcript?: unknown;
  roomId?: unknown;
  speak?: unknown;
  voice?: unknown;
};

function text(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max);
}

async function forwardToSpmt(accessToken: string, body: AthenaCommandBody) {
  const command = text(body.command || body.message || body.transcript, 5000);
  const response = await fetch(`${SPMT_BASE_URL}/api/athena/commands`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      command,
      roomId: text(body.roomId, 160) || undefined,
      speak: body.speak !== false,
      voice: text(body.voice, 128) || undefined,
    }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(65000) : undefined,
  });
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || 'Invalid SPMT response' }; }
  return { response, payload };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as AthenaCommandBody | null;
  const command = text(body?.command || body?.message || body?.transcript, 5000);
  if (!command) {
    return NextResponse.json({ error: 'command is required' }, { status: 400 });
  }

  let accessToken = text(request.cookies.get(HMO_SPMT_COOKIE)?.value, 10000);
  if (!accessToken) {
    return NextResponse.json({ error: 'Sign in with SPMT to use Athena' }, { status: 401 });
  }

  let upstream = await forwardToSpmt(accessToken, { ...body, command });
  let refreshed: Awaited<ReturnType<typeof refreshHmoSpmtSession>> = null;

  if (upstream.response.status === 401) {
    const refreshToken = text(request.cookies.get(HMO_SPMT_REFRESH_COOKIE)?.value, 10000);
    refreshed = refreshToken ? await refreshHmoSpmtSession(refreshToken) : null;
    if (refreshed) {
      accessToken = refreshed.accessToken;
      upstream = await forwardToSpmt(accessToken, { ...body, command });
    }
  }

  const response = NextResponse.json(upstream.payload, { status: upstream.response.status });
  response.headers.set('cache-control', 'private, no-store');

  if (refreshed) {
    response.cookies.set(HMO_SPMT_COOKIE, refreshed.accessToken, {
      ...hmoSpmtCookieOptions,
      maxAge: refreshed.expiresIn,
    });
    response.cookies.set(HMO_SPMT_REFRESH_COOKIE, refreshed.refreshToken, {
      ...hmoSpmtCookieOptions,
      maxAge: refreshed.refreshExpiresIn,
    });
  }

  return response;
}
