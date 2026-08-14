import { NextRequest, NextResponse } from 'next/server';
import {
  HMO_SPMT_COOKIE,
  HMO_SPMT_REFRESH_COOKIE,
  hmoSpmtCookieOptions,
  refreshHmoSpmtSession,
} from '@/lib/spmt-session';

const STREAMWEAVER_BASE_URL = String(
  process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev',
).replace(/\/$/, '');

async function fetchCatalog(accessToken: string) {
  return fetch(`${STREAMWEAVER_BASE_URL}/api/spmt/bots`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(12000) : undefined,
  });
}

export async function GET(request: NextRequest) {
  let accessToken = String(request.cookies.get(HMO_SPMT_COOKIE)?.value || '').trim();
  if (!accessToken) {
    return NextResponse.json({ error: 'Sign in with SPMT to view bots' }, { status: 401 });
  }

  let upstream = await fetchCatalog(accessToken);
  let refreshed: Awaited<ReturnType<typeof refreshHmoSpmtSession>> = null;

  if (upstream.status === 401) {
    const refreshToken = String(request.cookies.get(HMO_SPMT_REFRESH_COOKIE)?.value || '').trim();
    refreshed = refreshToken ? await refreshHmoSpmtSession(refreshToken) : null;
    if (refreshed) {
      accessToken = refreshed.accessToken;
      upstream = await fetchCatalog(accessToken);
    }
  }

  const raw = await upstream.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || 'Invalid StreamWeaver response' }; }

  const response = NextResponse.json(payload, { status: upstream.status });
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
