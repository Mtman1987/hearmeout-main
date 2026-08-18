import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const callbackRoute = new URL('../src/app/api/auth/spmt/callback/route.ts', import.meta.url);
const loginRoute = new URL('../src/app/api/auth/spmt/login/route.ts', import.meta.url);

test('SPMT OAuth callback never redirects to the Fly bind address', async () => {
  const source = await readFile(callbackRoute, 'utf8');
  assert.match(source, /DEFAULT_PUBLIC_ORIGIN = 'https:\/\/hearmeout-main\.fly\.dev'/);
  assert.match(source, /NEXT_PUBLIC_APP_URL/);
  assert.match(source, /x-forwarded-host/);
  assert.match(source, /NextResponse\.redirect\(new URL\('\/', publicOrigin\(request\)\)\)/);
  assert.doesNotMatch(source, /NextResponse\.redirect\(new URL\('\/', request\.url\)\)/);
});

test('SPMT authorize and token exchange use the same registered public callback', async () => {
  const login = await readFile(loginRoute, 'utf8');
  const callback = await readFile(callbackRoute, 'utf8');
  assert.match(login, /https:\/\/hearmeout-main\.fly\.dev\/api\/auth\/spmt\/callback/);
  assert.match(callback, /`\$\{DEFAULT_PUBLIC_ORIGIN\}\/api\/auth\/spmt\/callback`/);
  assert.match(login, /client_id', 'hearmeout'/);
  assert.match(callback, /client_id: 'hearmeout'/);
});
