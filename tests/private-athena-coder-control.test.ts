import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(__dirname, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('private Athena room routes coding intents through Rotator with SPMT bearer auth', () => {
  const helper = read('src/lib/private-athena-coder.ts');
  const route = read('src/app/api/private-assistant/route.ts');

  assert.match(helper, /\/api\/athena\/control/);
  assert.match(helper, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(helper, /action: 'create'/);
  assert.match(helper, /action: 'status'/);
  assert.match(helper, /artifact: 'diff'/);
  assert.match(helper, /artifact: 'checks'/);
  assert.match(helper, /action: 'publish'/);
  assert.match(helper, /confirmed: false/);
  assert.match(helper, /confirmed: true/);
  assert.match(helper, /privateAthenaControl/);
  assert.match(helper, /lastJobId/);
  assert.match(helper, /pendingPublish/);
  assert.match(helper, /that fix|that repair/);
  assert.match(route, /maybeHandlePrivateAthenaCoder/);
  assert.match(route, /caller-local-tts/);
});

test('normal private Athena conversation remains available when no coder intent matches', () => {
  const route = read('src/app/api/private-assistant/route.ts');
  assert.match(route, /if \(coder\.handled\)/);
  assert.match(route, /const result = await forwardCommand\(command, room\.id, bot, tokens\)/);
  assert.match(route, /await ensurePersona\(room\.id, bot, tokens\)/);
});
