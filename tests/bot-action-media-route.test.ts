import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
}

test('HearMeOut bot media actions require service authentication', () => {
  const route = source('src/app/api/internal/bot/actions/route.ts');
  assert.ok(route.indexOf('isBotActionServiceRequest') < route.indexOf('requestWatchMusicItem({'));
  assert.match(source('src/lib/bot-action-service-auth.ts'), /timingSafeEqual/);
});

test('the bot adapter reuses the canonical HearMeOut media services', () => {
  const route = source('src/app/api/internal/bot/actions/route.ts');
  assert.match(route, /getPublicWatchSession\(/);
  assert.match(route, /requestWatchMusicItem\(/);
  assert.match(route, /controlWatchSession\(/);
  assert.match(route, /getRoomWatchSessionId\(roomId, 'music'\)/);
});

test('the service-authenticated route bypasses only user middleware and authenticates itself', () => {
  const middleware = source('src/middleware.ts');
  assert.match(middleware, /'\/api\/internal\/bot\/actions'/);
  const route = source('src/app/api/internal/bot/actions/route.ts');
  assert.match(route, /return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/);
});

test('media controls are restricted to the explicit safe control set', () => {
  const route = source('src/app/api/internal/bot/actions/route.ts');
  assert.match(route, /new Set\(\['play', 'pause', 'next', 'clear', 'mute', 'unmute', 'volume'\]\)/);
  assert.match(route, /Unsupported media control/);
});

test('the internal adapter exposes room, tenant persona, and voice bridge actions', () => {
  const route = source('src/app/api/internal/bot/actions/route.ts');
  for (const action of [
    'hmo.rooms.read',
    'hmo.bot.control',
    'hmo.voice.bridge.state',
    'hmo.voice.bridge.control',
  ]) assert.match(route, new RegExp(action.replaceAll('.', '\\.')));
  assert.match(route, /listRoomsForBotAction\(/);
  assert.match(route, /changeRoomPersonaForBotAction\(/);
  assert.match(route, /readVoiceBridgeForBotAction\(/);
  assert.match(route, /controlVoiceBridgeForBotAction\(/);
});

test('room actions enforce management, hide unrelated private rooms, and use worker authentication', () => {
  const service = source('src/lib/bot-room-action-service.ts');
  assert.match(service, /!room\.isPrivate \|\| canActorManageRoom/);
  assert.match(service, /resolveManagedRoomForBotAction/);
  assert.match(service, /canManageRoom\(actor, ownerId\)/);
  assert.doesNotMatch(service, /isActivityRoomId\(text\(room\?\.id/);
  assert.match(service, /getDjWorkerRequestHeaders/);
  assert.match(service, /serviceSession: input\.control === 'join'/);
});

test('voice bridge bot actions apply the privacy gate and roll back a failed start', () => {
  const service = source('src/lib/bot-room-action-service.ts');
  assert.match(service, /'\/voice-bridge\/gate'/);
  assert.match(service, /roomVoiceOutboundEnabled/);
  assert.match(service, /body: JSON\.stringify\(\{ action: 'stop', roomId: room\.id \}\)/);
  assert.match(service, /voiceBridge: \{ \.\.\.next, enabled: false \}/);
});

test('room persona worker no longer forwards speech commands or owns STT', () => {
  const runtime = source('worker/src/persona-runtime-adapter.js');
  const bootstrap = source('worker/src/persona-bootstrap.js');
  assert.doesNotMatch(runtime, /\/api\/internal\/persona-command|persona-transcribe|runCommand\(|processUtterance|onAudioFrame/);
  assert.match(runtime, /speechInputRoute:\s*'browser-persona-transcribe-to-bot-commands'/);
  assert.match(bootstrap, /serviceSession: req\.body\?\.serviceSession === true/);
  assert.match(bootstrap, /app\.post\('\/persona\/speak'/);
});
