export const HMO_SPMT_COOKIE = 'hmo_spmt_session';
export const HMO_SPMT_REFRESH_COOKIE = 'hmo_spmt_refresh';
export const HMO_SPMT_STATE_COOKIE = 'hmo_spmt_oauth_state';
export const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export const hmoSpmtCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
};

export type RefreshedHmoSpmtSession = {
  user?: any;
  localSession?: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
};

export async function createRefreshedHmoLocalSession(userId: string): Promise<string | undefined> {
  const secret = process.env.HEARMEOUT_JWT_SECRET || process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'hearmeout-local-development-only');
  if (!secret) return undefined;
  const encode = (value: string) => btoa(value).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = encode(JSON.stringify({ uid: `spmt_${userId}`, exp: Math.floor(Date.now() / 1000) + 2592000 }));
  const input = `${header}.${body}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input)));
  return `${input}.${encode(String.fromCharCode(...signature))}`;
}

export async function refreshHmoSpmtSession(refreshToken: string): Promise<RefreshedHmoSpmtSession | null> {
  const clientSecret = String(process.env.HEARMEOUT_CLIENT_SECRET || '').trim();
  if (!refreshToken || !clientSecret) return null;
  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: 'hearmeout',
      client_secret: clientSecret,
    }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null);
  if (!payload?.access_token || !payload?.refresh_token) return null;
  return {
    user: payload.user,
    accessToken: String(payload.access_token),
    refreshToken: String(payload.refresh_token),
    expiresIn: Number(payload.expires_in || 604800),
    refreshExpiresIn: Number(payload.refresh_expires_in || 2592000),
  };
}
