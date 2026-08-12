import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const botApiRoute = new URL('../src/app/api/bot/commands/route.ts', import.meta.url);
const athenaAliasRoute = new URL('../src/app/api/athena/commands/route.ts', import.meta.url);
const chatBox = new URL('../src/app/rooms/[roomId]/_components/ChatBox.tsx', import.meta.url);

test('HearMeOut forwards generic bot commands with its existing SPMT OAuth session', async () => {
  const source = await readFile(botApiRoute, 'utf8');
  assert.match(source, /HMO_SPMT_COOKIE/);
  assert.match(source, /HMO_SPMT_REFRESH_COOKIE/);
  assert.match(source, /refreshHmoSpmtSession/);
  assert.match(source, /\/api\/bot\/commands/);
  assert.match(source, /Authorization: `Bearer \$\{accessToken\}`/);

  for (const deprecated of ['SYSTEM_API_KEY', 'SPMT_API_KEY', 'x-spmt-key', 'x-bot-secret']) {
    assert.equal(source.includes(deprecated), false, `HearMeOut bot route must not use ${deprecated}`);
  }
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
  assert.match(source, /participant\.identity\.replace\(\/\^persona:\//);
  assert.match(source, /if \(!room\)/);
});

test('room chat uses the generic bot API and server-returned bot name', async () => {
  const source = await readFile(chatBox, 'utf8');
  assert.match(source, /fetch\("\/api\/bot\/commands"/);
  assert.match(source, /payload\?\.bot\?\.name/);
  assert.match(source, /speak: false/);
  assert.doesNotMatch(source, /fetch\("\/api\/athena\/commands"/);
  assert.doesNotMatch(source, /sendToAthena/);
});

test('Athena wake names remain backward-compatible without owning a separate command path', async () => {
  const source = await readFile(chatBox, 'utf8');
  assert.match(source, /@\?athena/);
  assert.match(source, /Compatibility only/);
});
