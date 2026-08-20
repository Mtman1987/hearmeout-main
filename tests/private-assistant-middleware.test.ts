import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const middleware = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/app/api/private-assistant/route.ts', import.meta.url), 'utf8');

test('private assistant bypasses browser-session middleware but keeps launch-code auth', () => {
  assert.match(middleware, /['"]\/api\/private-assistant['"]/);
  assert.ok(route.includes("if (!launchCode) return NextResponse.json({ ok: false, error: 'launchCode is required'"));
  assert.match(route, /exchangeLaunchCode\(launchCode\)/);
  assert.match(route, /\/api\/embed\/exchange/);
});
