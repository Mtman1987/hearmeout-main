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

test('typed chat and automatic room voice use the same explicit wake-name resolver', () => {
  const routing = source('src/lib/room-persona-routing.ts');
  const chat = source('src/app/rooms/[roomId]/_components/ChatBox.tsx');
  const wake = source('src/app/rooms/[roomId]/_components/WakeWordListener.tsx');

  assert.match(routing, /export function resolveBotInvocation/);
  assert.match(routing, /wakeNameMatchIndex/);
  assert.doesNotMatch(routing, /Math\.random|interestChance|interestedBots/);
  assert.match(chat, /room-persona-routing/);
  assert.match(chat, /resolveBotInvocation\(submittedText, activeBotParticipants\)/);
  assert.match(wake, /room-persona-routing/);
  assert.match(wake, /resolveBotInvocation\(transcript, targets\)/);
});

test('automatic wake word records the already-published LiveKit microphone and reuses the proven STT path', () => {
  const wake = source('src/app/rooms/[roomId]/_components/WakeWordListener.tsx');
  const client = source('src/lib/room-persona-client.ts');
  const users = source('src/app/rooms/[roomId]/_components/UserList.tsx');

  assert.match(users, /<WakeWordListener roomId=\{roomId\} remoteParticipants=\{remoteParticipants\}/);
  assert.match(wake, /getTrackPublication\?\.\(Track\.Source\.Microphone\)|getTrackPublication\(Track\.Source\.Microphone\)/);
  assert.match(wake, /sourceTrack\.clone\(\)/);
  assert.match(wake, /new MediaRecorder/);
  assert.match(wake, /START_RMS/);
  assert.match(wake, /SILENCE_TO_SEND_MS/);
  assert.match(wake, /transcribeRoomPersonaAudio\(blob\)/);
  assert.match(wake, /sendRoomPersonaCommand/);
  assert.match(client, /\/api\/internal\/persona-transcribe/);
  assert.match(client, /\/api\/bot\/commands/);
});

test('push-to-talk and browser SpeechRecognition are removed from the room voice path', () => {
  const userCard = source('src/app/rooms/[roomId]/_components/UserCard.tsx');
  const mobile = source('src/app/rooms/[roomId]/_components/MobileVoiceControl.tsx');
  assert.equal(exists('src/hooks/use-voice-controls.ts'), false);
  assert.doesNotMatch(userCard, /pushToTalk|Push-to-talk|\bPTT\b/);
  assert.doesNotMatch(mobile, /Hold to talk|SpeechRecognition|webkitSpeechRecognition|speechSynthesis/);
  assert.match(mobile, /Wake-name listening is automatic/);
});

test('worker owns persona RTC output but never runs a second STT or command listener', () => {
  const runtime = source('worker/src/persona-runtime-adapter.js');
  const bootstrap = source('worker/src/persona-bootstrap.js');
  assert.doesNotMatch(runtime, /onAudioFrame|processUtterance|persona-transcribe|\/api\/internal\/persona-command/);
  assert.match(runtime, /speechInputRoute:\s*'browser-persona-transcribe-to-bot-commands'/);
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
  assert.match(command, /healthyWorkerPersona/);
  assert.match(command, /method:\s*'GET'/);
  assert.match(command, /Self-heal\/upgrade|self-heal/i);
  assert.match(command, /persistent:\s*true/);
});

test('persona invite stays token-free for human conversation and worker keeps the TTS endpoint', () => {
  const sessionRoute = source('src/app/api/bots/session/route.ts');
  const bootstrap = source('worker/src/persona-bootstrap.js');
  const commandRoute = source('src/app/api/bot/commands/route.ts');
  assert.match(sessionRoute, /serviceSession:\s*action === 'join'/);
  assert.doesNotMatch(sessionRoute, /spmtAccessToken:/);
  assert.doesNotMatch(sessionRoute, /spmtRefreshToken:/);
  assert.match(bootstrap, /app\.post\('\/persona\/speak'/);
  assert.match(commandRoute, /\/persona\/speak/);
});

test('persona LiveKit transport rejects stale sessions and re-invite replaces them', () => {
  const session = source('worker/src/persona-session.js');
  const bootstrap = source('worker/src/persona-bootstrap.js');
  assert.match(session, /isHealthy\(\)/);
  assert.match(session, /Persona session is not connected to a publishable LiveKit track/);
  assert.match(session, /Math\.ceil\(input\.length \/ bytesPerFrame\)/);
  assert.match(bootstrap, /replacing stale LiveKit session/);
  assert.match(bootstrap, /transportHealthy/);
  assert.match(bootstrap, /Persona LiveKit transport is stale; re-invite the persona/);
});

test('manual Talk button is only a fallback and shares the same STT and bot-command client', () => {
  const card = source('src/app/rooms/[roomId]/_components/PersonaCard.tsx');
  assert.match(card, /transcribeRoomPersonaAudio/);
  assert.match(card, /sendRoomPersonaCommand/);
  assert.match(card, /Fallback button/);
  assert.doesNotMatch(card, /fetch\('\/api\/internal\/persona-transcribe'/);
  assert.doesNotMatch(card, /fetch\('\/api\/bot\/commands'/);
});

test('persona runtime status records the single browser wake-word input architecture', () => {
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
  assert.equal(status.wakePolicy, 'browser-vad-stt-explicit-name-only');
  assert.equal(status.speechInputRoute, 'browser-persona-transcribe-to-bot-commands');
});
