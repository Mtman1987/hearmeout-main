import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('HearMeOut room renders and unlocks remote LiveKit audio', async () => {
  const source = await readFile('src/app/rooms/[roomId]/page.tsx', 'utf8');
  assert.ok(source.includes('<RoomAudioRenderer'));
  assert.ok(source.includes('const fallbackRoom = !voiceReady || voiceFallbackActive ? getFallbackRoom() : null'));
  assert.ok(source.includes('<RoomContext.Provider value={fallbackRoom}>'));
  assert.ok(source.includes('RoomEvent.AudioPlaybackStatusChanged'));
  assert.ok(source.includes('await room.startAudio()'));
  assert.ok(source.includes('<RoomAudioPlayback volume={localVolume}'));
  assert.ok(source.includes('Enable room and bot audio'));
});

test('typed and spoken persona replies use the room-scoped hidden Say Player queue', async () => {
  const chat = await readFile('src/app/rooms/[roomId]/_components/ChatBox.tsx', 'utf8');
  const wake = await readFile('src/app/rooms/[roomId]/_components/WakeWordListener.tsx', 'utf8');
  const client = await readFile('src/lib/room-persona-client.ts', 'utf8');
  const route = await readFile('src/app/api/bot/commands/route.ts', 'utf8');

  assert.ok(chat.includes('sendRoomPersonaCommand'));
  assert.ok(wake.includes('sendRoomPersonaCommand'));
  assert.ok(client.includes('speak: true'));
  assert.ok(route.includes('/api/say/queue'));
  assert.ok(route.includes('tts?.streamKey'));
  assert.ok(route.includes('queuedResult.skipped'));
  assert.ok(route.includes("queuedResult.result?.reason === 'no-active-say-listener'"));
  assert.ok(route.includes('for (let attempt = 0; attempt < 3 && queuedResult.skipped; attempt += 1)'));
  assert.ok(route.includes('setTimeout(resolve, 1100)'));
  assert.ok(!route.includes('deliveryTenantId = personaId'));
  assert.ok(route.includes('text: responseText'));
  assert.ok(!route.includes('/persona/speak'));
});

test('production has no direct browser TTS diagnostic player', async () => {
  const layout = await readFile('src/app/layout.tsx', 'utf8');
  const route = await readFile('src/app/api/bot/commands/route.ts', 'utf8');

  assert.ok(!layout.includes('TtsDiagnosticHost') && !layout.includes('tts-diagnostic-host'));
  await assert.rejects(
    readFile('src/components/tts-diagnostic-host.tsx', 'utf8'),
    (error: any) => error?.code === 'ENOENT',
  );
  assert.ok(route.includes('room roster is the invite authority'));
  assert.ok(!route.includes('healthyWorkerPersona') && !route.includes('transportHealthy === true'));
  assert.ok(route.includes('say-player-not-listening') || route.includes('delivered: result?.delivered'));
});

test('late LiveKit audio elements inherit the selected output device', async () => {
  const source = await readFile('src/hooks/use-audio-device.ts', 'utf8');
  assert.ok(source.includes('MutationObserver'));
  assert.ok(source.includes('applyOutputDevice(activeDeviceId)'));
  assert.ok(source.includes('setSinkId'));
});
