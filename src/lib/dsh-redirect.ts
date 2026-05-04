// HMAC signature verification for redirects from DSH (Discord Stream Hub)
// back to HMO. Without this, anyone can craft a URL like
//   /api/auth/discord/callback?success=true&user_id=<victim>&username=victim
// and HMO will sign them in as that user (S10/S11/S12 in the audit).
//
// Strict mode (REQUIRE_DSH_SIGNATURE=1):
//   - All success=true redirects must include &exp=<unix>&sig=<hex>
//   - sig = HMAC-SHA256(DSH_REDIRECT_SECRET, `${provider}|${user_id}|${exp}`)
//
// Lax mode (default, back-compat):
//   - If `sig` is present, it MUST verify.
//   - If `sig` is absent, log a warning but allow the redirect (so the app
//     keeps working until DSH is updated to sign). Once DSH is signing,
//     flip REQUIRE_DSH_SIGNATURE=1 on Fly to enforce.

import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '@/lib/config';

export type Provider = 'discord' | 'twitch';

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export function verifyDshRedirect(
  provider: Provider,
  params: URLSearchParams,
): VerifyResult {
  const userId = params.get('user_id');
  if (!userId) return { ok: false, reason: 'missing user_id' };

  const sig = params.get('sig');
  const exp = params.get('exp');
  const secret = config.dshRedirectSecret;

  // No signature provided
  if (!sig || !exp) {
    if (config.requireDshSignature) {
      return { ok: false, reason: 'missing signature' };
    }
    if (!secret) {
      console.warn(
        `[dsh-redirect] WARNING: ${provider} redirect for user_id=${userId} ` +
          'is unsigned and DSH_REDIRECT_SECRET is unset. Set both DSH and HMO ' +
          'with the same DSH_REDIRECT_SECRET, then set REQUIRE_DSH_SIGNATURE=1.',
      );
    } else {
      console.warn(
        `[dsh-redirect] WARNING: ${provider} redirect for user_id=${userId} ` +
          'is unsigned (DSH not yet upgraded). Allowing in lax mode.',
      );
    }
    return { ok: true };
  }

  if (!secret) {
    return { ok: false, reason: 'sig provided but DSH_REDIRECT_SECRET unset on HMO' };
  }

  const expNum = Number(exp);
  if (!Number.isFinite(expNum)) return { ok: false, reason: 'invalid exp' };
  if (Math.floor(Date.now() / 1000) > expNum) return { ok: false, reason: 'expired' };

  const expected = createHmac('sha256', secret)
    .update(`${provider}|${userId}|${exp}`)
    .digest('hex');

  if (sig.length !== expected.length) return { ok: false, reason: 'bad sig length' };

  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return { ok: false, reason: 'bad sig encoding' };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'sig mismatch' };

  return { ok: true };
}
