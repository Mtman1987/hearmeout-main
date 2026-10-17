'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PersonaRuntimeAdapter } = require('../worker/src/persona-runtime-adapter');

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

function exists(relative) {
  return fs.existsSync(path.join(__dirname, '..', relative));
}

test('typed chat and local Companion wake use the same explicit wake-name resolver', () => {
  const routing = source('src/lib/room-persona-routing.ts');
  const chat = source('src/app/rooms/[roomId]/_components/ChatBox.tsx');
  const wake = source('src/app/rooms/[roomId]/_components/WakeWordListener.tsx');

  assert.match(routing, /export function resolveBotInvocation/);
  assert.match(routing, /wakeNameMatchIndex/);
  assert.doesNotMatch(routing, /Math\.random|interestChance|interestedBots/);
  assert.match(chat, /room-persona-routing/);
  assert.match(chat, /resolveBotInvocation\(submittedText, activeBotParticipants\)/);
  assert.match(chat, /useCollection<RoomBotPresence>/);
  assert.match(chat, /activeRoomId \? `rooms\//);
  assert.match(chat, /presence\.presenceKind !== 'persona'/);
  assert.match(wake, /room-persona-routing/);
  assert.match(wake, /resolveBotInvocation\(transcript, targets\)/);
});

test('Athena explicitly accepts Hey Athena through the shared typed-and-local-wake resolver', () => {
  const routing = source('src/lib/room-persona-routing.ts');
  assert.match(routing, /expandedWakeNames/);
  assert.match(routing, /names\.push\('Hey Athena'\)/);
  assert.match(routing, /expandedWakeNames\(bot\)/);
});

test('ambient browser speech never reaches cloud STT; local Companion supplies wake transcripts', () => {
  const wake = source('src/app/rooms/[roomId]/_components/WakeWordListener.tsx');
  const client = source('src/lib/room-persona-client.ts');
  const users = source('src/app/rooms/[roomId]/_components/UserList.tsx');
  const mobile = source('src/app/rooms/[roomId]/_components/MobileVoiceControl.tsx');

  assert.match(users, /<WakeWordListener roomId=\{roomId\} remoteParticipants=\{voiceInputParticipants\}/);
  assert.match(users, /const voiceInputParticipants = remoteParticipants\.filter\(/);
  assert.match(users, /!isRoomTtsParticipant\(participant\?\.identity\) && !isHiddenBridgeParticipant\(participant\?\.identity\)/);
  assert.match(wake, /LOCAL_COMPANION_WAKE_EVENT\s*=\s*'spmt-companion-athena-command'/);
  assert.match(wake, /window\.addEventListener\(LOCAL_COMPANION_WAKE_EVENT/);
  assert.match(wake, /sendRoomPersonaCommand/);
  assert.doesNotMatch(wake, /MediaRecorder/);
  assert.doesNotMatch(wake, /AudioContext|webkitAudioContext/);
  assert.doesNotMatch(wake, /Track\.Source\.Microphone|getTrackPublication/);
  assert.doesNotMatch(wake, /transcribeRoomPersonaAudio/);
  assert.doesNotMatch(wake, /persona-transcribe/);
  assert.match(client, /\/api\/internal\/persona-transcribe/);
  assert.match(client, /\/api\/bot\/commands/);
  assert.match(mobile, /HearMeOut does not continuously send room speech to cloud STT/);
  assert.match(mobile, /Hands-free wake is local/);
});

test('persona commands use the real participant identity and never generic room actor labels', () => {
  const client = source('src/lib/room-persona-client.ts');
  const command = source('src/app/api/bot/commands/route.ts');
  const compatibility = source('src/app/api/internal/persona-command/route.ts');

  assert.match(client, /actorIdentity/);
  assert.match(client, /actorDisplayName/);
  assert.match(command, /resolvePublicActor/);
  assert.match(command, /getSession/);
  assert.match(command, /\.\.\.actor/);
  assert.doesNotMatch(command, /HearMeOut visitor|HearMeOut room/);
  assert.doesNotMatch(compatibility, /HearMeOut room/);
});

test('push-to-talk and browser SpeechRecognition remain removed from the room voice path', () => {
  const userCard = source('src/app/rooms/[roomId]/_components/UserCard.tsx');
  const mobile = source('src/app/rooms/[roomId]/_components/MobileVoiceControl.tsx');
  assert.equal(exists('src/hooks/use-voice-controls.ts'), false);
  assert.doesNotMatch(userCard, /pushToTalk|Push-to-talk|\bPTT\b/);
  assert.doesNotMatch(mobile, /Hold to talk|SpeechRecognition|webkitSpeechRecognition|speechSynthesis/);
  assert.match(mobile, /Hands-free wake is local/);
});

test('worker owns persona RTC output but never runs a second STT or command listener', () => {
  const runtime = source('worker/src/persona-runtime-adapter.js');
  const bootstrap = source('worker/src/persona-bootstrap.js');
  assert.doesNotMatch(runtime, /onAudioFrame\s*\(/);
  assert.doesNotMatch(runtime, /processUtterance\s*\(/);
  assert.doesNotMatch(runtime, /fetch\([^\n]*persona-transcribe/);
  assert.doesNotMatch(runtime, /fetch\([^\n]*\/api\/internal\/persona-command/);
  assert.match(runtime, /speechInputRoute:\s*'local-companion-event-to-bot-commands'/);
  assert.match(runtime, /listeners:\s*0/);
  assert.match(bootstrap, /app\.post\('\/persona\/speak'/);
});

test('persona presence is persistent and never expires with the 45 second human heartbeat', () => {
  const prune = source('src/app/api/presence/prune/route.ts');
  const session = source('src/app/api/bots/session/route.ts');
  const command = source('src/app/api/bot/commands/route.ts');

  assert.match(prune, /isPersistentPersonaPresence/);
  assert.match(prune, /presenceKind === 'persona'/);
  assert.match(prune, /continue;/);
  assert.match(session, /presenceKind:\s*'persona'/);
  assert.match(session, /persistent:\s*true/);
  assert.doesNotMatch(command, /healthyWorkerPersona/);
  assert.doesNotMatch(command, /getDjWorkerUrl\(\).*persona/);
  assert.match(command, /const presence = db\.get/);
  assert.match(command, /presence\.bot === true/);
  assert.match(session, /speechMode:\s*'say-player'/);
  assert.match(session, /joinMode:\s*'say-player-only'/);
  assert.match(command, /room roster is the invite authority/);
});

test('persona invite stays token-free while public persona speech uses StreamWeaver Say', () => {
  const sessionRoute = source('src/app/api/bots/session/route.ts');
  const bootstrap = source('worker/src/persona-bootstrap.js');
  const commandRoute = source('src/app/api/bot/commands/route.ts');
  assert.match(sessionRoute, /joinMode:\s*'say-player-only'/);
  assert.doesNotMatch(sessionRoute, /getDjWorkerUrl|mintPersonaToken|LiveKit token route/);
  assert.doesNotMatch(sessionRoute, /spmtAccessToken:/);
  assert.doesNotMatch(sessionRoute, /spmtRefreshToken:/);
  assert.match(bootstrap, /app\.post\('\/persona\/speak'/);
  assert.match(commandRoute, /\/api\/say\/queue/);
  assert.doesNotMatch(commandRoute, /\/persona\/speak/);
});

test('room persona invites and commands do not depend on LiveKit or P2P', () => {
  const session = source('src/app/api/bots/session/route.ts');
  const command = source('src/app/api/bot/commands/route.ts');
  const service = source('src/lib/bot-room-action-service.ts');
  assert.match(session, /joinMode:\s*'say-player-only'/);
  assert.match(service, /joinMode:\s*'say-player-only'/);
  assert.doesNotMatch(session, /getDjWorkerUrl|mintPersonaToken|LiveKit token route/);
  assert.doesNotMatch(service, /callWorker\('\/persona'/);
  assert.doesNotMatch(command, /healthyWorkerPersona|transportHealthy === true/);
  assert.match(command, /room roster is the invite authority/);
});

test('manual Talk button is the deliberate cloud-STT fallback and shares the bot-command client', () => {
  const card = source('src/app/rooms/[roomId]/_components/PersonaCard.tsx');
  assert.match(card, /transcribeRoomPersonaAudio/);
  assert.match(card, /sendRoomPersonaCommand/);
  assert.match(card, /Fallback button/);
  assert.doesNotMatch(card, /fetch\('\/api\/internal\/persona-transcribe'/);
  assert.doesNotMatch(card, /fetch\('\/api\/bot\/commands'/);
});

test('persona runtime status records the local Companion wake-word architecture', () => {
  const runtime = new PersonaRuntimeAdapter({
    roomId: 'studio',
    personaId: 'athena',
    displayName: 'Athena',
    ownerTenantId: 'athena',
    wakeNames: ['Athena', 'Annie'],
    serviceSession: true,
  });
  runtime.start();
  const status = runtime.status();
  assert.equal(status.active, true);
  assert.equal(status.authenticationMode, 'service');
  assert.equal(status.listeners, 0);
  assert.equal(status.wakePolicy, 'local-companion-explicit-name-only');
  assert.equal(status.speechInputRoute, 'local-companion-event-to-bot-commands');
});
