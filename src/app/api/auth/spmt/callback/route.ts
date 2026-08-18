import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { db, ensureDb } from '@/lib/db';
import { setSessionCookie } from '@/lib/auth';
import { HMO_SPMT_COOKIE, HMO_SPMT_REFRESH_COOKIE, HMO_SPMT_STATE_COOKIE, SPMT_BASE_URL, hmoSpmtCookieOptions } from '@/lib/spmt-session';
import { enrichUserFromDSH } from '@/lib/enrich-user';

const DEFAULT_PUBLIC_ORIGIN = 'https://hearmeout-main.fly.dev';

function equalState(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicOrigin(request: NextRequest) {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (configured && !/^https?:\/\/(?:0\.0\.0\.0|127\.0\.0\.1|localhost)(?::|\/|$)/i.test(configured)) return configured;
  const forwardedHost = String(request.headers.get('x-forwarded-host') || '').split(',')[0].trim();
  const forwardedProto = String(request.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim() || 'https';
  if (forwardedHost && !/^(?:0\.0\.0\.0|127\.0\.0\.1|localhost)(?::|$)/i.test(forwardedHost)) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return DEFAULT_PUBLIC_ORIGIN;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code') || '';
  const state = request.nextUrl.searchParams.get('state') || '';
  const expected = request.cookies.get(HMO_SPMT_STATE_COOKIE)?.value || '';
  if (!code || !state || !expected || !equalState(state, expected)) return NextResponse.json({ error: 'Invalid or expired SPMT sign-in state' }, { status: 400 });
  const clientSecret = process.env.HEARMEOUT_CLIENT_SECRET || '';
  if (!clientSecret) return NextResponse.json({ error: 'HearMeOut SPMT OAuth is not configured' }, { status: 503 });
  const redirectUri = `${DEFAULT_PUBLIC_ORIGIN}/api/auth/spmt/callback`;
  const exchange = await fetch(`${SPMT_BASE_URL}/api/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code, client_id: 'hearmeout', client_secret: clientSecret, redirect_uri: redirectUri }), cache: 'no-store',
  });
  const payload = await exchange.json().catch(() => null);
  if (!exchange.ok || !payload?.access_token || !payload?.user?.id) return NextResponse.json({ error: 'SPMT sign-in exchange failed' }, { status: 401 });
  await ensureDb();
  const user = payload.user;
  const uid = `spmt_${user.id}`;
  await db.setAsync('users', uid, {
    id: uid,
    spmtUserId: String(user.id),
    username: String(user.username || user.displayName || 'SPMT User'),
    displayName: String(user.displayName || user.username || 'SPMT User'),
    email: user.email || null,
    photoURL: user.avatarUrl || user.avatar_url || null,
    discordId: user.discordId || null,
    twitchUsername: user.twitchUsername || null,
  });
  if (user.discordId) {
    await enrichUserFromDSH(String(user.discordId), uid);
  }
  await setSessionCookie(uid);
  const response = NextResponse.redirect(new URL('/', publicOrigin(request)));
  response.cookies.set(HMO_SPMT_COOKIE, payload.access_token, { ...hmoSpmtCookieOptions, maxAge: Number(payload.expires_in || 604800) });
  if (payload.refresh_token) response.cookies.set(HMO_SPMT_REFRESH_COOKIE, payload.refresh_token, { ...hmoSpmtCookieOptions, maxAge: Number(payload.refresh_expires_in || 2592000) });
  response.cookies.set(HMO_SPMT_STATE_COOKIE, '', { ...hmoSpmtCookieOptions, maxAge: 0 });
  return response;
}
