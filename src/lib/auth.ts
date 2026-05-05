// JWT session auth — replaces Firebase Auth entirely
// DSH is the auth authority: it does OAuth, writes user to shared SQLite,
// sets a signed JWT cookie, and redirects back to HearMeOut.
// HearMeOut just reads and verifies the cookie.

import { cookies } from 'next/headers';
import { createHmac } from 'crypto';
import { db, ensureDb } from '@/lib/db';
import { config } from '@/lib/config';

const FALLBACK_SECRET = 'hearmeout-internal-session-key';
function resolveJwtSecret(): string {
  if (config.jwtSecret) return config.jwtSecret;
  return FALLBACK_SECRET;
}
const JWT_SECRET = resolveJwtSecret();

const COOKIE_NAME = 'hmo_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

interface JwtPayload {
  uid: string;
  exp: number;
}

function base64url(str: string): string {
  return Buffer.from(str).toString('base64url');
}

function sign(payload: JwtPayload): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verify(token: string): JwtPayload | null {
  if (!JWT_SECRET) return null; // no key configured = no valid sessions
  try {
    const [header, body, signature] = token.split('.');
    const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (signature !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as JwtPayload;
    if (payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionToken(uid: string): string {
  return sign({ uid, exp: Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE });
}

export async function setSessionCookie(uid: string): Promise<void> {
  const token = createSessionToken(uid);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSession(): Promise<{ uid: string; user: any } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = verify(token);
  if (!payload) return null;

  await ensureDb();
  const user = db.get('users', payload.uid);
  if (!user) return null;

  return { uid: payload.uid, user };
}

// For API routes that need to verify auth
export async function requireAuth(): Promise<{ uid: string; user: any }> {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');
  return session;
}
