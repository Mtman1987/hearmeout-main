import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const middleware = readFileSync(resolve(process.cwd(), 'src/middleware.ts'), 'utf8');
const livekitRoute = readFileSync(resolve(process.cwd(), 'src/app/api/livekit-token/route.ts'), 'utf8');
const personaWorker = readFileSync(resolve(process.cwd(), 'worker/src/persona-bootstrap.js'), 'utf8');

test('LiveKit token machine callback bypasses browser SPMT middleware', () => {
  assert.match(middleware, /['"]\/api\/livekit-token['"]/);
  assert.match(livekitRoute, /isDjWorkerRequest\(request\)/);
  assert.match(livekitRoute, /persona && fromDjWorker/);
  assert.match(personaWorker, /\/api\/livekit-token/);
  assert.match(personaWorker, /Authorization: `Bearer \$\{secret\}`/);
});
