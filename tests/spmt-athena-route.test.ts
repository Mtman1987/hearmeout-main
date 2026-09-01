import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const botApiRoute = new URL('../src/app/api/bot/commands/route.ts', import.meta.url);
const personaCommandRoute = new URL('../src/app/api/internal/persona-command/route.ts', import.meta.url);
const botsApiRoute = new URL('../src/app/api/bots/route.ts', import.meta.url);
const botSessionRoute = new URL('../src/app/api/bots/session/route.ts', import.meta.url);
const livekitTokenRoute = new URL('../src/app/api/livekit-token/route.ts', import.meta.url);
const athenaAliasRoute = new URL('../src/app/api/athena/commands/route.ts', import.meta.url);
const chatBox = new URL('../src/app/rooms/[roomId]/_components/ChatBox.tsx', import.meta.url);
const botPicker = new URL('../src/app/rooms/[roomId]/_components/BotPicker.tsx', import.meta.url);
const personaCard = new URL('../src/app/rooms/[roomId]/_components/PersonaCard.tsx', import.meta.url);
const personaBootstrap = new URL('../worker/src/persona-bootstrap.js', import.meta.url);
const workerPackage = new URL('../worker/package.json', import.meta.url);

test('HearMeOut human bot conversation never depends on a user SPMT session or bot-share', async () => {
  const source = await readFile(botApiRoute, 'utf8');
  assert.match(source, /publicPersonaIsInRoom/);
  assert.match(source, /\/api\/internal\/hearmeout\/persona-command/);
  assert.match(source, /Bot Share is bot-to-bot only/);
  assert.doesNotMatch(source, /HMO_SPMT_COOKIE/);
  assert.doesNotMatch(source, /HMO_SPMT_REFRESH_COOKIE/);
  assert.doesNotMatch(source, /refreshHmoSpmtSession/);
  assert.doesNotMatch(source, /\/api\/spmt\/bot\/commands/);
  assert.doesNotMatch(source, /getBotShareMode|BOT_NOT_SHARED/);
});

test('spoken persona commands use the worker-authenticated public service path only', async () => {
  const source = await readFile(personaCommandRoute, 'utf8');
  assert.match(source, /isDjWorkerRequest/);
  assert.match(source, /\/api\/internal\/hearmeout\/persona-command/);
  assert.match(source, /forwardService/);
  assert.doesNotMatch(source, /refreshHmoSpmtSession/);
  assert.doesNotMatch(source, /accessToken|refreshToken/);
  assert.doesNotMatch(source, /\/api\/spmt\/bot\/commands/);
});

test('old Athena API is only a compatibility alias to the generic bot route', async () => {
  const source = await readFile(athenaAliasRoute, 'utf8');
  assert.match(source, /Compatibility alias/);
  assert.match(source, /\.\.\/\.\.\/bot\/commands\/route/);
  assert.doesNotMatch(source, /HMO_SPMT_COOKIE/);
});

test('room chat discovers actual LiveKit bot participants without requiring LiveKit to exist', async () => {
  const source = await readFile(chatBox, 'utf8');
  assert.match(source, /useContext\(RoomContext\)/);
  assert.match(source, /room\.remoteParticipants\.values\(\)/);
  assert.match(source, /RoomEvent\.ParticipantConnected/);
  assert.match(source, /RoomEvent\.ParticipantDisconnected/);
  assert.match(source, /RoomEvent\.ParticipantMetadataChanged/);
  assert.match(source, /isPersonaParticipant/);
  assert.match(source, /parsePersonaMetadata/);
  assert.match(source, /metadata\.displayName/);
  assert.match(source, /metadata\.personaId/);
  assert.match(source, /metadata\.ownerTenantId/);
  assert.match(source, /participant\.identity\.replace\(\/\^persona:\//);
  assert.match(source, /if \(!room\)/);
});

test('room chat uses the generic bot API and asks the joined persona to speak', async () => {
  const source = await readFile(chatBox, 'utf8');
  assert.match(source, /fetch\("\/api\/bot\/commands"/);
  assert.match(source, /payload\?\.bot\?\.name/);
  assert.match(source, /targetTenantId/);
  assert.match(source, /speak: true/);
  assert.match(source, /could not respond/);
  assert.match(source, /voice playback failed/);
  assert.doesNotMatch(source, /fetch\("\/api\/athena\/commands"/);
  assert.doesNotMatch(source, /sendToAthena/);
});

test('room bot mentions use whole-word matching anywhere in the sentence', async () => {
  const source = await readFile(chatBox, 'utf8');
  assert.match(source, /wakeNameMatchIndex/);
  assert.match(source, /\(\^\|\[\^a-z0-9_\]\)@\?/);
  assert.doesNotMatch(source, /new RegExp\(`\^\\\\s\*@\?/);
  assert.match(source, /index < bestMatch\.index/);
  assert.match(source, /ATHENA_COMPAT_WAKE_NAMES/);
  assert.match(source, /"Athena"/);
  assert.match(source, /"Annie"/);
});

test('connected personas can publish aliases, ownership, and historical wake names', async () => {
  const chatSource = await readFile(chatBox, 'utf8');
  const personaSource = await readFile(personaCard, 'utf8');
  assert.match(chatSource, /\.\.\.\(metadata\.wakeNames \|\| \[\]\)/);
  assert.match(chatSource, /\.\.\.\(metadata\.aliases \|\| \[\]\)/);
  assert.match(chatSource, /\.\.\.\(metadata\.previousNames \|\| \[\]\)/);
  assert.match(personaSource, /wakeNames\?: string\[\]/);
  assert.match(personaSource, /aliases\?: string\[\]/);
  assert.match(personaSource, /previousNames\?: string\[\]/);
  assert.match(personaSource, /ownerTenantId\?: string/);
  assert.match(personaSource, /Owned by/);
});

test('room bot picker is an all-SPMT public persona gallery', async () => {
  const chatSource = await readFile(chatBox, 'utf8');
  const pickerSource = await readFile(botPicker, 'utf8');
  assert.match(chatSource, /\^!bots/);
  assert.match(chatSource, /\^!\(join\|leave\)/);
  assert.match(chatSource, /<BotPicker/);
  assert.match(pickerSource, /\/api\/bots/);
  assert.match(pickerSource, /\/api\/bots\/session/);
  assert.match(pickerSource, /Meet the SPMT bots/);
  assert.match(pickerSource, /Streamer:/);
  assert.match(pickerSource, /Bot Share does not control human conversation/);
  assert.match(pickerSource, /blockedReason/);
  assert.match(pickerSource, /Invite/);
});

test('bot join API uses room management plus the public persona catalog, never SPMT bot-share auth', async () => {
  const source = await readFile(botSessionRoute, 'utf8');
  assert.match(source, /canManageRoom/);
  assert.match(source, /Only the room owner or room staff can manage bots/);
  assert.match(source, /\/api\/internal\/hearmeout\/bots/);
  assert.match(source, /getDjWorkerRequestHeaders/);
  assert.match(source, /\/persona/);
  assert.match(source, /serviceSession: action === 'join'/);
  assert.doesNotMatch(source, /HMO_SPMT_COOKIE|refreshHmoSpmtSession|getBotShareMode/);
});

test('available bot list is the trusted all-SPMT public persona catalog', async () => {
  const source = await readFile(botsApiRoute, 'utf8');
  assert.match(source, /getStreamWeaverServiceSecret/);
  assert.match(source, /\/api\/internal\/hearmeout\/bots/);
  assert.doesNotMatch(source, /HMO_SPMT_COOKIE|refreshHmoSpmtSession|\/api\/spmt\/bots/);
});

test('persona worker joins the plain voice room with worker-authenticated LiveKit tokens', async () => {
  const workerSource = await readFile(personaBootstrap, 'utf8');
  const livekitSource = await readFile(livekitTokenRoute, 'utf8');
  const workerPkg = JSON.parse(await readFile(workerPackage, 'utf8'));
  assert.match(workerSource, /PersonaSession/);
  assert.match(workerSource, /app\.post\('\/persona'/);
  assert.match(workerSource, /HMO_WORKER_SHARED_SECRET/);
  assert.match(workerSource, /personaMetadata/);
  assert.match(livekitSource, /persona && fromDjWorker/);
  assert.match(livekitSource, /`persona:\$\{cleanPersonaId\}`/);
  assert.match(livekitSource, /canPublish: true, canSubscribe: true/);
  assert.match(workerPkg.scripts.start, /persona-bootstrap\.js/);
});

test('Athena wake names remain backward-compatible without owning a separate command path', async () => {
  const source = await readFile(chatBox, 'utf8');
  assert.match(source, /ATHENA_COMPAT_WAKE_NAMES/);
  assert.match(source, /"Athena OS"/);
  assert.match(source, /"Athena"/);
  assert.match(source, /"Annie"/);
});
