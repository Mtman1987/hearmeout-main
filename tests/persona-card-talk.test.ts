import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function source(relative: string) {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
}

test('persona Talk uses bounded portable microphone capture and the canonical STT and bot client', () => {
  const card = source('src/app/rooms/[roomId]/_components/PersonaCard.tsx');
  const client = source('src/lib/room-persona-client.ts');

  assert.match(card, /captureMicrophone/);
  assert.doesNotMatch(card, /new MediaRecorder|audio\/webm/);
  assert.match(card, /transcribeRoomPersonaAudio/);
  assert.match(card, /sendRoomPersonaCommand/);
  assert.match(card, /You said/);
  assert.match(card, /Talk to \$\{displayName\}/);
  assert.match(card, /Fallback button/);
  assert.doesNotMatch(card, /fetch\('\/api\/internal\/persona-transcribe'/);
  assert.doesNotMatch(card, /fetch\('\/api\/bot\/commands'/);
  assert.match(client, /\/api\/internal\/persona-transcribe/);
  assert.match(client, /\/api\/bot\/commands/);
  assert.match(client, /speak:\s*true/);
});

test('public persona transcription does not demand another user session', () => {
  const route = source('src/app/api/internal/persona-transcribe/route.ts');

  assert.doesNotMatch(route, /getSession/);
  assert.doesNotMatch(route, /isDjWorkerRequest/);
  assert.doesNotMatch(route, /Unauthorized/);
  assert.match(route, /\/api\/speech\/transcribe/);
  assert.match(route, /MAX_AUDIO_BASE64_LENGTH/);
});

test('public room persona chat uses the public service route with no user token or StreamWeaver secret', () => {
  const route = source('src/app/api/bot/commands/route.ts');

  assert.match(route, /forwardPublicRoomPersona/);
  assert.match(route, /\/api\/internal\/hearmeout\/persona-command/);
  assert.match(route, /publicPersonaIsInRoom/);
  // Room-roster membership is authoritative in the current Say Player-only flow.
  assert.doesNotMatch(route, /healthyWorkerPersona/);
  assert.match(route, /persona:\$\{targetTenantId\}/);
  assert.match(route, /StreamWeaver bearer secret/);
  assert.doesNotMatch(route, /getStreamWeaverServiceSecret|STREAMWEAVER_SECRET/);
  assert.doesNotMatch(route, /Authorization:\s*`Bearer/);
  assert.doesNotMatch(route, /accessToken|refreshToken/);
  assert.doesNotMatch(route, /HMO_SPMT_COOKIE|HMO_SPMT_REFRESH_COOKIE/);
  assert.doesNotMatch(route, /refreshHmoSpmtSession/);
  assert.doesNotMatch(route, /\/api\/spmt\/bot\/commands/);
  assert.doesNotMatch(route, /Sign in with SPMT/);
});

test('HearMeOut middleware never asks for SPMT again on public persona interaction', () => {
  const middleware = source('src/middleware.ts');
  const publicCheck = middleware.indexOf('PUBLIC_PREFIXES.some');
  const identityCheck = middleware.indexOf('resolveIdentity(request)');

  assert.ok(publicCheck >= 0 && identityCheck > publicCheck, 'public route bypass must run before SPMT identity lookup');
  for (const route of [
    '/api/bots',
    '/api/bot/commands',
    '/api/rooms/persona-speech',
    '/api/athena/commands',
    '/api/internal/persona-transcribe',
    '/api/internal/persona-command',
  ]) {
    assert.ok(middleware.includes(`'${route}'`), `${route} must bypass SPMT user-session middleware`);
  }
});


test('bot talk details collapse behind the mic control without unmounting the Say Player', () => {
  const card = source('src/app/rooms/[roomId]/_components/PersonaCard.tsx');
  const userList = source('src/app/rooms/[roomId]/_components/UserList.tsx');

  assert.match(card, /aria-expanded=\{talkPanelOpen\}/);
  assert.match(card, /\{talkPanelOpen && \(/);
  assert.match(card, /volumeOverride\?: number/);
  assert.match(card, /metadata\.sayPlayer && onVolumeOverrideChange/);
  assert.match(card, /aria-label=\{`\$\{displayName\} volume`\}/);
  assert.doesNotMatch(card, /\{!metadata\.sayPlayer && \(/);
  assert.match(userList, /speechPersonaIds\.length > 0 && <RoomSayPlayerAudio/);
  assert.match(userList, /const activePersonas = \(users \|\| \[\]\)\.filter/);
  assert.match(userList, /const speechPersonaIds = activePersonas/);
  assert.match(userList, /isLocal=\{participant === localParticipant\}/);
  assert.match(userList, /sayPlayer:\s*true/);
  assert.match(userList, /volumesByPersona/);

  const commands = source('src/app/api/bot/commands/route.ts');
  assert.match(commands, /attempt < 3 && queuedResult\.skipped/);
  assert.match(commands, /queueSpeech\(sayStreamKey\)/);
  assert.doesNotMatch(commands, /deliveryTenantId = personaId/);
});

test('Discord Activity panel is hidden by default and opened from the DJ card', () => {
  const page = source('src/app/rooms/[roomId]/page.tsx');
  const userList = source('src/app/rooms/[roomId]/_components/UserList.tsx');
  const dj = source('src/app/rooms/[roomId]/_components/DJCard.tsx');
  assert.match(page, /const \[showDiscordActivity, setShowDiscordActivity\] = useState\(false\)/);
  assert.match(page, /isActivityRoomId\(roomId\) \? \(\s*showDiscordActivity \?/);
  assert.match(page, /onToggleDiscordActivity=\{isActivityRoom \?/);
  assert.match(userList, /onToggleDiscordActivity/);
  assert.match(dj, /aria-label=\{showDiscordActivity \? 'Hide Discord Activity panel' : 'Show Discord Activity panel'\}/);
});

test('bridge card shows one active Discord speaker avatar without rendering a roster', () => {
  const card = source('src/app/rooms/[roomId]/_components/VoiceBridgeCard.tsx');

  assert.match(card, /discordPresence\?: \{ displayName\?: string; photoURL\?: string; source\?: string \}/);
  assert.match(card, /status\?\.discordPresence\?\.photoURL/);
  assert.match(card, /status\?\.discordPresence\?\.displayName/);
  assert.match(card, /Active Discord speaker/);
  assert.doesNotMatch(card, /discordMembers|activeSpeakers/);
});

test('Discord Activities keeps shared session selection but uses the movable controls instead of a permanent iframe', () => {
  const page = source('src/app/rooms/[roomId]/page.tsx');
  const userList = source('src/app/rooms/[roomId]/_components/UserList.tsx');

  assert.match(page, /onOpenControls: \(kind: WatchMediaKind\) => void/);
  assert.match(page, /Open \{selectedLane\.label\} Controls/);
  assert.match(page, /onOpenControls=\{\(kind\) => openPopout\('watch'/);
  assert.doesNotMatch(page, /title=\{\x60\$\{selectedLane\.label\} Discord Activity playback\x60\}/);
  assert.match(page, /!voiceFallbackActive \|\| voiceFallbackFailed \|\| !peerVoiceRef\.current\?\.active/);
  assert.match(userList, /Your browser blocked incoming P2P audio/);
  assert.match(userList, /Enable P2P Audio/);
});
