import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('HearMeOut room renders and unlocks remote LiveKit audio', async () => {
  const source = await readFile('src/app/rooms/[roomId]/page.tsx', 'utf8');
  assert.match(source, /<RoomAudioRenderer\s*\/>/);
  assert.match(source, /RoomEvent\.AudioPlaybackStatusChanged/);
  assert.match(source, /await room\.startAudio\(\)/);
  assert.match(source, /<RoomAudioPlayback volume=\{localVolume\}\s*\/>/);
  assert.match(source, /Enable room and bot audio/);
});

test('typed bot messages request TTS and hand it to the persona room track', async () => {
  const chat = await readFile('src/app/rooms/[roomId]/_components/ChatBox.tsx', 'utf8');
  const route = await readFile('src/app/api/bot/commands/route.ts', 'utf8');
  const worker = await readFile('worker/src/persona-bootstrap.js', 'utf8');

  assert.match(chat, /speak:\s*true/);
  assert.match(route, /\/persona\/speak/);
  assert.match(route, /audioDataUri/);
  assert.match(worker, /audioDataUriToPcm\(audioDataUri\)/);
  assert.match(worker, /record\.persona\.pushPcm\(pcm\)/);
});

test('late LiveKit audio elements inherit the selected output device', async () => {
  const source = await readFile('src/hooks/use-audio-device.ts', 'utf8');
  assert.match(source, /MutationObserver/);
  assert.match(source, /applyOutputDevice\(activeDeviceId\)/);
  assert.match(source, /setSinkId/);
});
