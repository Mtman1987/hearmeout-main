import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { HMO_SPMT_STATE_COOKIE, hmoSpmtCookieOptions } from '@/lib/spmt-session';

export async function GET() {
  const state = randomBytes(24).toString('base64url');
  const redirectUri = 'https://hearmeout-main.fly.dev/api/auth/spmt/callback';
  const authorize = new URL('https://spmt.live/api/oauth/authorize');
  authorize.searchParams.set('client_id', 'hearmeout');
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('state', state);
  const response = NextResponse.redirect(authorize);
  response.cookies.set(HMO_SPMT_STATE_COOKIE, state, { ...hmoSpmtCookieOptions, maxAge: 600 });
  return response;
}
