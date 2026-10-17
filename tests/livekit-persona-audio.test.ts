import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('HearMeOut room renders and unlocks remote LiveKit audio', async () => {
  const source = await readFile('src/app/rooms/[roomId]/page.tsx', 'utf8');
  assert.match(source, /<RoomAudioRenderer\s*\/>/);
  assert.match(source, /const fallbackRoom = !voiceReady \|\| voiceFallbackActive \? getFallbackRoom\(\) : null/);
  assert.match(source, /<RoomContext\.Provider value=\{fallbackRoom\}>/);
  assert.match(source, /RoomEvent\.AudioPlaybackStatusChanged/);
  assert.match(source, /await room\.startAudio\(\)/);
  assert.match(source, /<RoomAudioPlayback volume=\{localVolume\}\s*\/>/);
  assert.match(source, /Enable room and bot audio/);
});

test('typed and spoken persona replies use the canonical StreamWeaver Say broadcast queue', async () => {
  const chat = await readFile('src/app/rooms/[roomId]/_components/ChatBox.tsx', 'utf8');
  const wake = await readFile('src/app/rooms/[roomId]/_components/WakeWordListener.tsx', 'utf8');
  const client = await readFile('src/lib/room-persona-client.ts', 'utf8');
  const route = await readFile('src/app/api/bot/commands/route.ts', 'utf8');

  assert.match(chat, /sendRoomPersonaCommand/);
  assert.match(wake, /sendRoomPersonaCommand/);
  assert.match(client, /speak:\s*true/);
  assert.match(route, /\/api\/say\/queue/);
  assert.match(route, /tts\?\.streamKey/);
  assert.match(route, /tenantId:\s*sayStreamKey\s*\|\|\s*personaId/);
  assert.match(route, /text:\s*responseText/);
  assert.doesNotMatch(route, /\/persona\/speak/);
});
test('production has no direct browser TTS diagnostic player', async () => {
  const layout = await readFile('src/app/layout.tsx', 'utf8');
  const route = await readFile('src/app/api/bot/commands/route.ts', 'utf8');

  assert.doesNotMatch(layout, /TtsDiagnosticHost|tts-diagnostic-host/);
  await assert.rejects(
    readFile('src/components/tts-diagnostic-host.tsx', 'utf8'),
    (error: any) => error?.code === 'ENOENT',
  );
  assert.match(route, /room roster is the invite authority/);
  assert.doesNotMatch(route, /healthyWorkerPersona|transportHealthy === true/);
  assert.match(route, /say-player-not-listening|delivered: result\?\.delivered/);
});

test('late LiveKit audio elements inherit the selected output device', async () => {
  const source = await readFile('src/hooks/use-audio-device.ts', 'utf8');
  assert.match(source, /MutationObserver/);
  assert.match(source, /applyOutputDevice\(activeDeviceId\)/);
  assert.match(source, /setSinkId/);
});
