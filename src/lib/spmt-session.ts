export const HMO_SPMT_COOKIE = 'hmo_spmt_session';
export const HMO_SPMT_STATE_COOKIE = 'hmo_spmt_oauth_state';
export const SPMT_BASE_URL = 'https://spmt.live';

export const hmoSpmtCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
};
