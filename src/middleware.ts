import { NextRequest, NextResponse } from 'next/server';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');
const SPMT_COOKIE = 'hmo_spmt_session';

const PUBLIC_PREFIXES = [
  '/api/auth/',
  '/api/health',
  '/api/webhooks/',
  '/api/discord/',
  '/api/worker/',
  '/api/livekit/webhook',
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

async function resolveIdentity(request: NextRequest) {
  const token = request.cookies.get(SPMT_COOKIE)?.value || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
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

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix)) || isStatic(pathname)) {
    return NextResponse.next();
  }

  const identity = await resolveIdentity(request);
  if (!identity) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'SPMT session required' }, { status: 401 });
    const login = new URL('/api/auth/spmt/login', request.url);
    login.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  if (ADMIN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix)) && !isAdmin(identity)) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'SPMT admin required' }, { status: 403 });
    return NextResponse.redirect(new URL('/', request.url));
  }

  const headers = new Headers(request.headers);
  headers.set('x-spmt-user-id', String(identity.id));
  headers.set('x-spmt-is-admin', isAdmin(identity) ? '1' : '0');
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
