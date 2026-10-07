import { createHmac, timingSafeEqual } from 'node:crypto';
import { twitchMusicSessionId } from './twitch-media-scope';
function sourceToken(tenantId: string) {
  const secret = process.env.HMO_WORKER_SHARED_SECRET || process.env.HEARMEOUT_SERVICE_SECRET || process.env.BOT_SECRET_KEY;
  if (!secret) throw new Error('Twitch source signing credential is not configured');
  return createHmac('sha256', secret).update('obs-ended-v1:' + twitchMusicSessionId(tenantId)).digest('base64url');
}
export function twitchSourceUrl(tenantId: string, base: string) {
  const url = new URL('/overlay/twitch-' + tenantId.toLowerCase(), base);
  url.search = new URLSearchParams({ media: 'music', clean: '1', muted: '0', volume: '1', sourceKey: sourceToken(tenantId) }).toString();
  return url.toString();
}
export function validTwitchSource(tenantId: string, token: string) {
  try {
    const expected = Buffer.from(sourceToken(tenantId));
    const actual = Buffer.from(token);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
