import test from 'node:test';
import assert from 'node:assert/strict';
import { validVoiceSource, voiceSourceUrl } from '../src/lib/stream-voice-access';

test('stream listener capability is bound to exactly one room and fails closed', () => {
  process.env.HMO_WORKER_SHARED_SECRET = 'test-only-stream-voice-signing';
  const url = new URL(voiceSourceUrl('mtman', 'https://hearmeout-main.fly.dev'));
  const key = url.searchParams.get('sourceKey')!;
  assert(validVoiceSource('mtman', key));
  assert(!validVoiceSource('stream-thecaptaindash', key));
  assert(!validVoiceSource('mtman', ''));
  assert(!validVoiceSource('../mtman', key));
  delete process.env.HMO_WORKER_SHARED_SECRET;
  assert(!validVoiceSource('mtman', key));
});
