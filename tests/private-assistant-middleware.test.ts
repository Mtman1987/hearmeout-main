import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const middleware = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/app/api/private-assistant/route.ts', import.meta.url), 'utf8');

test('private assistant bypasses browser-session middleware but keeps launch-code auth', () => {
  assert.match(middleware, /['"]\/api\/private-assistant['"]/);
  assert.match(route, /if \(!launchCode\).*launchCode is required/s);
  assert.match(route, /exchangeLaunchCode\(launchCode\)/);
  assert.match(route, /\/api\/embed\/exchange/);
});
