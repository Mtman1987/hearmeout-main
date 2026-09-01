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
const wakeWordListener = new URL('../src/app/rooms/[roomId]/_components/WakeWordListener.tsx', import.meta.url);
const routing = new URL('../src/lib/room-persona-routing.ts', import.meta.url);
const roomPersonaClient = new URL('../src/lib/room-persona-client.ts', import.meta.url);
const botPicker = new URL('../src/app/rooms/[roomId]/_components/BotPicker.tsx', import.meta.url);
const personaCard = new URL('../src/app/rooms/[roomId]/_components/PersonaCard.tsx', import.meta.url);
const personaBootstrap = new URL('../worker/src/persona-bootstrap.js', import.meta.url);
const personaRuntime = new URL('../worker/src/persona-runtime-adapter.js', import.meta.url);
const workerPackage = new URL('../worker/package.json', import.meta.url);

test('HearMeOut human bot conversation never depends on a user SPMT session, bot-share, or StreamWeaver secret', async () => {
  const source = await readFile(botApiRoute, 'utf8');
  assert.match(source, /publicPersonaIsInRoom/);
  assert.match(source, /healthyWorkerPersona/);
  assert.match(source, /\/api\/internal\/hearmeout\/persona-command/);
  assert.match(source, /StreamWeaver bearer secret/);
  assert.doesNotMatch(source, /HMO_SPMT_COOKIE/);
  assert.doesNotMatch(source, /HMO_SPMT_REFRESH_COOKIE/);
  assert.doesNotMatch(source, /refreshHmoSpmtSession/);
  assert.doesNotMatch(source, /\/api\/spmt\/bot\/commands/);
  assert.doesNotMatch(source, /getBotShareMode|BOT_NOT_SHARED/);
  assert.doesNotMatch(source, /getStreamWeaverServiceSecret|STREAMWEAVER_SECRET/);
  assert.doesNotMatch(source, /Authorization:\s*`Bearer/);
});

test('worker no longer owns spoken STT or a second command path', async () => {
  const runtime = await readFile(personaRuntime, 'utf8');
  assert.doesNotMatch(runtime, /onAudioFrame\s*\(/);
  assert.doesNotMatch(runtime, /processUtterance\s*\(/);
  assert.doesNotMatch(runtime, /fetch\([^\n]*persona-transcribe/);
  assert.doesNotMatch(runtime, /fetch\([^\n]*\/api\/internal\/persona-command/);
  assert.match(runtime, /speechInputRoute:\s*'browser-persona-transcribe-to-bot-commands'/);
  assert.match(runtime, /listeners:\s*0/);
});

test('legacy internal persona command remains compatibility-only and is not called by the worker', async () => {
  const source = await readFile(personaCommandRoute, 'utf8');
  const runtime = await readFile(personaRuntime, 'utf8');
  assert.match(source, /\/api\/internal\/hearmeout\/persona-command/);
  assert.doesNotMatch(runtime, /fetch\([^\n]*\/api\/internal\/persona-command/);
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

test('room chat and wake-word speech both use the canonical persona client and generic bot API', async () => {
  const chatSource = await readFile(chatBox, 'utf8');
  const wakeSource = await readFile(wakeWordListener, 'utf8');
  const clientSource = await readFile(roomPersonaClient, 'utf8');
  assert.match(chatSource, /sendRoomPersonaCommand/);
  assert.match(wakeSource, /sendRoomPersonaCommand/);
  assert.match(clientSource, /fetch\('\/api\/bot\/commands'/);
  assert.match(clientSource, /targetTenantId/);
  assert.match(clientSource, /speak:\s*true/);
  assert.doesNotMatch(chatSource, /fetch\("\/api\/athena\/commands"/);
});

test('typed and spoken room bot mentions share whole-word wake-name matching', async () => {
  const routingSource = await readFile(routing, 'utf8');
  const chatSource = await readFile(chatBox, 'utf8');
  const wakeSource = await readFile(wakeWordListener, 'utf8');
  assert.match(routingSource, /wakeNameMatchIndex/);
  assert.match(routingSource, /\(\^\|\[\^a-z0-9_\]\)@\?/);
  assert.match(routingSource, /index < bestMatch\.index/);
  assert.doesNotMatch(routingSource, /Math\.random|interestedBots|interestChance/);
  assert.match(chatSource, /room-persona-routing/);
  assert.match(wakeSource, /room-persona-routing/);
});

test('connected personas can publish aliases, ownership, and historical wake names', async () => {
  const chatSource = await readFile(chatBox, 'utf8');
  const wakeSource = await readFile(wakeWordListener, 'utf8');
  const personaSource = await readFile(personaCard, 'utf8');
  assert.match(chatSource, /\.\.\.\(metadata\.wakeNames \|\| \[\]\)/);
  assert.match(chatSource, /\.\.\.\(metadata\.aliases \|\| \[\]\)/);
  assert.match(chatSource, /\.\.\.\(metadata\.previousNames \|\| \[\]\)/);
  assert.match(wakeSource, /\.\.\.\(metadata\.wakeNames \|\| \[\]\)/);
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

test('bot join API uses room management plus the public persona catalog, never SPMT bot-share or StreamWeaver secret auth', async () => {
  const source = await readFile(botSessionRoute, 'utf8');
  assert.match(source, /canManageRoom/);
  assert.match(source, /Only the room owner or room staff can manage bots/);
  assert.match(source, /\/api\/internal\/hearmeout\/bots/);
  assert.match(source, /getDjWorkerRequestHeaders/);
  assert.match(source, /\/persona/);
  assert.match(source, /serviceSession: action === 'join'/);
  assert.match(source, /presenceKind:\s*'persona'/);
  assert.match(source, /persistent:\s*true/);
  assert.doesNotMatch(source, /HMO_SPMT_COOKIE|refreshHmoSpmtSession|getBotShareMode/);
  assert.doesNotMatch(source, /getStreamWeaverServiceSecret|STREAMWEAVER_SECRET/);
  assert.doesNotMatch(source, /Authorization:\s*`Bearer/);
});

test('available bot list uses the public all-SPMT persona catalog with no StreamWeaver secret', async () => {
  const source = await readFile(botsApiRoute, 'utf8');
  assert.match(source, /\/api\/internal\/hearmeout\/bots/);
  assert.doesNotMatch(source, /getStreamWeaverServiceSecret|STREAMWEAVER_SECRET/);
  assert.doesNotMatch(source, /Authorization:\s*`Bearer/);
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

test('Athena wake names stay backward compatible through joined persona metadata, not a separate command path', async () => {
  const chatSource = await readFile(chatBox, 'utf8');
  const wakeSource = await readFile(wakeWordListener, 'utf8');
  for (const name of ['Athena OS', 'Athena', 'Annie']) {
    assert.ok(chatSource.includes(`'${name}'`) || wakeSource.includes(`'${name}'`), `${name} wake name is missing`);
  }
});
