import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL('../' + relativePath, import.meta.url)), 'utf8');
}

test('internal bot actions expose canonical watch requests for StreamWeaver', () => {
  const route = source('src/app/api/internal/bot/actions/route.ts');
  assert.match(route, /'hmo\.watch\.request'/);
  assert.match(route, /requestWatchItem\(/);
  assert.match(route, /getRoomWatchSessionId\(roomId, 'movie'\)/);
  assert.match(route, /Added "/);
});
