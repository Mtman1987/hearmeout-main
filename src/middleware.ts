import { NextRequest, NextResponse } from 'next/server';
import { createRefreshedHmoLocalSession, HMO_SPMT_REFRESH_COOKIE, refreshHmoSpmtSession, type RefreshedHmoSpmtSession } from '@/lib/spmt-session';
import { isActivityEntry, isPublicActivityRequest } from '@/lib/activity-access';

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
  // Public chatbot interaction must never be stopped by the SPMT user-session
  // middleware. These routes perform only room/persona interaction; account,
  // owner, and administrator controls remain protected elsewhere.
  '/api/bots',
  '/api/bot/commands',
  '/api/athena/commands',
  '/api/internal/persona-transcribe',
  '/api/internal/persona-command',
  // This route has its own server-to-server SPMT launch-code exchange. It must
  // be reachable before a HearMeOut browser/session cookie exists; otherwise
  // MountainView's authenticated private-Athena bootstrap is rejected here.
  '/api/private-assistant',
  // This route performs its own service-auth check; SPMT user middleware must
  // not consume its machine credential first.
  '/api/internal/bot/actions',
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
  identity = refreshed.user?.id ? refreshed.user : await fetchIdentity(refreshed.accessToken);
  if (identity?.id) refreshed.localSession = await createRefreshedHmoLocalSession(String(identity.id));
  return { identity, refreshed };
}

function withRefresh(response: NextResponse, refreshed: RefreshedHmoSpmtSession | null) {
  if (refreshed) {
    if (refreshed.localSession) response.cookies.set('hmo_session', refreshed.localSession, { httpOnly: true, secure: true, sameSite: 'none', path: '/', maxAge: 2592000 });
    response.cookies.set(SPMT_COOKIE, refreshed.accessToken, { httpOnly: true, secure: true, sameSite: 'none', path: '/', maxAge: refreshed.expiresIn });
    response.cookies.set(HMO_SPMT_REFRESH_COOKIE, refreshed.refreshToken, { httpOnly: true, secure: true, sameSite: 'none', path: '/', maxAge: refreshed.refreshExpiresIn });
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isPublicActivityRequest(request.nextUrl, request.method)) {
    // Root URL mappings must reach the standalone player before the React
    // account shell mounts. Keep Discord's origin and all launch parameters.
    if (pathname === '/' && isActivityEntry(request.nextUrl)) {
      const activity = request.nextUrl.clone();
      activity.pathname = '/activity';
      return NextResponse.rewrite(activity);
    }
    return NextResponse.next();
  }
  // The .js entry can contain a private session id; do not let the generic
  // static-file exception turn that into a public entry point.
  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix)) || (isStatic(pathname) && !isActivityEntry(request.nextUrl))) {
    return NextResponse.next();
  }

  const { identity, refreshed } = await resolveIdentity(request);
  if (!identity) {
    if (pathname.startsWith('/api/')) return withRefresh(NextResponse.json({ error: 'SPMT session required' }, { status: 401 }), refreshed);
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return withRefresh(NextResponse.redirect(login), refreshed);
  }

  if (ADMIN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix)) && !isAdmin(identity)) {
    if (pathname.startsWith('/api/')) return withRefresh(NextResponse.json({ error: 'SPMT admin required' }, { status: 403 }), refreshed);
    return withRefresh(NextResponse.redirect(new URL('/', request.url)), refreshed);
  }

  if (refreshed) {
    request.cookies.set('hmo_spmt_session', refreshed.accessToken);
    request.cookies.set('hmo_spmt_refresh', refreshed.refreshToken);
    if (refreshed.localSession) request.cookies.set('hmo_session', refreshed.localSession);
  }
  const headers = new Headers(request.headers);
  headers.set('x-spmt-user-id', String(identity.id));
  headers.set('x-spmt-is-admin', isAdmin(identity) ? '1' : '0');
  return withRefresh(NextResponse.next({ request: { headers } }), refreshed);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
