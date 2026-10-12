import { createHmac, timingSafeEqual } from 'node:crypto';

export function validVoiceRoomId(value: string) {
  return /^[A-Za-z0-9_-]{1,96}$/.test(value);
}

function voiceSourceKey(roomId: string) {
  if (!validVoiceRoomId(roomId)) throw new Error('Invalid voice room');
  const secret = process.env.HMO_WORKER_SHARED_SECRET;
  if (!secret) throw new Error('Voice source signing is not configured');
  return createHmac('sha256', secret).update('stream-voice-v1:' + roomId).digest('base64url');
}

export function voiceSourceUrl(roomId: string, base: string) {
  const url = new URL('/overlay/voices/' + encodeURIComponent(roomId), base);
  url.searchParams.set('sourceKey', voiceSourceKey(roomId));
  return url.toString();
}

export function validVoiceSource(roomId: string, key: string) {
  try {
    const expected = Buffer.from(voiceSourceKey(roomId));
    const actual = Buffer.from(key);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
