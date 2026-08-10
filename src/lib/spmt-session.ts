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
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
};

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
    accessToken: String(payload.access_token),
    refreshToken: String(payload.refresh_token),
    expiresIn: Number(payload.expires_in || 604800),
    refreshExpiresIn: Number(payload.refresh_expires_in || 2592000),
  };
}
