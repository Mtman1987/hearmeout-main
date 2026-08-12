import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const apiRoute = new URL('../src/app/api/athena/commands/route.ts', import.meta.url);
const chatBox = new URL('../src/app/rooms/[roomId]/_components/ChatBox.tsx', import.meta.url);

test('HearMeOut forwards Athena commands with its existing SPMT OAuth session', async () => {
  const source = await readFile(apiRoute, 'utf8');
  assert.match(source, /HMO_SPMT_COOKIE/);
  assert.match(source, /HMO_SPMT_REFRESH_COOKIE/);
  assert.match(source, /refreshHmoSpmtSession/);
  assert.match(source, /\/api\/athena\/commands/);
  assert.match(source, /Authorization: `Bearer \$\{accessToken\}`/);

  for (const deprecated of ['SYSTEM_API_KEY', 'SPMT_API_KEY', 'x-spmt-key', 'x-bot-secret']) {
    assert.equal(source.includes(deprecated), false, `HearMeOut Athena route must not use ${deprecated}`);
  }
});

test('HearMeOut room chat invokes the canonical Athena route for Athena-prefixed messages', async () => {
  const source = await readFile(chatBox, 'utf8');
  assert.match(source, /isAthenaInvocation/);
  assert.match(source, /fetch\("\/api\/athena\/commands"/);
  assert.match(source, /username: "Athena"/);
  assert.match(source, /speak: false/);
});
