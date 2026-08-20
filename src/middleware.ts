import { NextRequest, NextResponse } from 'next/server';
import { HMO_SPMT_REFRESH_COOKIE, refreshHmoSpmtSession, type RefreshedHmoSpmtSession } from '@/lib/spmt-session';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');
const SPMT_COOKIE = 'hmo_spmt_session';

const PUBLIC_PREFIXES = [
  '/login',
  '/api/auth/',
  '/api/health',
  '/api/webhooks/',
  '/api/discord/',
  '/api/worker/',
  '/api/livekit/webhook',
  '/api/livekit-token',
  // This route has its own server-to-server SPMT launch-code exchange. It must
  // be reachable before a HearMeOut browser/session cookie exists; otherwise
  // MountainView's authenticated private-Athena bootstrap is rejected here.
  '/api/private-assistant',
  '/overlay',
  '/embed',
  '/room-overlay',
  '/now-playing',
  '/_next/',
  '/favicon.ico',
];

const ADMIN_PREFIXES = ['/admin', '/api/admin/', '/api/settings/admin', '/api/moderation/'];

function isStatic(pathname: string) {
  return pathname.includes('.') && !pathname.endsWith('.html');
}

function isAdmin(identity: any): boolean {
  if (identity?.isAdmin === true || identity?.is_admin === true || identity?.is_admin === 1) return true;
  const role = String(identity?.role || '').toLowerCase();
  const roles = Array.isArray(identity?.roles) ? identity.roles.map((value: unknown) => String(value).toLowerCase()) : [];
  return role === 'admin' || role === 'owner' || roles.includes('admin') || roles.includes('owner');
}

async function fetchIdentity(token: string) {
  if (!token) return null;
  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null);
  const identity = payload?.user || payload?.profile || payload;
  return identity?.id ? identity : null;
}

async function resolveIdentity(request: NextRequest): Promise<{ identity: any; refreshed: RefreshedHmoSpmtSession | null }> {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const token = request.cookies.get(SPMT_COOKIE)?.value || bearer;
  let identity = await fetchIdentity(token);
  if (identity || bearer) return { identity, refreshed: null };
  const refreshed = await refreshHmoSpmtSession(request.cookies.get(HMO_SPMT_REFRESH_COOKIE)?.value || '');
  if (!refreshed) return { identity: null, refreshed: null };
  identity = await fetchIdentity(refreshed.accessToken);
  return { identity, refreshed: identity ? refreshed : null };
}

function withRefresh(response: NextResponse, refreshed: RefreshedHmoSpmtSession | null) {
  if (refreshed) {
    response.cookies.set(SPMT_COOKIE, refreshed.accessToken, { httpOnly: true, secure: true, sameSite: 'none', path: '/', maxAge: refreshed.expiresIn });
    response.cookies.set(HMO_SPMT_REFRESH_COOKIE, refreshed.refreshToken, { httpOnly: true, secure: true, sameSite: 'none', path: '/', maxAge: refreshed.refreshExpiresIn });
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix)) || isStatic(pathname)) {
    return NextResponse.next();
  }

  const { identity, refreshed } = await resolveIdentity(request);
  if (!identity) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'SPMT session required' }, { status: 401 });
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  if (ADMIN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix)) && !isAdmin(identity)) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'SPMT admin required' }, { status: 403 });
    return withRefresh(NextResponse.redirect(new URL('/', request.url)), refreshed);
  }

  const headers = new Headers(request.headers);
  headers.set('x-spmt-user-id', String(identity.id));
  headers.set('x-spmt-is-admin', isAdmin(identity) ? '1' : '0');
  return withRefresh(NextResponse.next({ request: { headers } }), refreshed);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
