import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
}

test('HearMeOut bot media actions require service authentication', () => {
  const route = source('src/app/api/internal/bot/actions/route.ts');
  assert.ok(route.indexOf('isBotActionServiceRequest') < route.indexOf('requestWatchMusicItem({'));
  assert.match(source('src/lib/bot-action-service-auth.ts'), /timingSafeEqual/);
});

test('the bot adapter reuses the canonical HearMeOut media services', () => {
  const route = source('src/app/api/internal/bot/actions/route.ts');
  assert.match(route, /getPublicWatchSession\(/);
  assert.match(route, /requestWatchMusicItem\(/);
  assert.match(route, /controlWatchSession\(/);
  assert.match(route, /getRoomWatchSessionId\(roomId, 'music'\)/);
});

test('the service-authenticated route bypasses only user middleware and authenticates itself', () => {
  const middleware = source('src/middleware.ts');
  assert.match(middleware, /'\/api\/internal\/bot\/actions'/);
  const route = source('src/app/api/internal/bot/actions/route.ts');
  assert.match(route, /return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/);
});

test('media controls are restricted to the explicit safe control set', () => {
  const route = source('src/app/api/internal/bot/actions/route.ts');
  assert.match(route, /new Set\(\['play', 'pause', 'next', 'clear', 'mute', 'unmute', 'volume'\]\)/);
  assert.match(route, /Unsupported media control/);
});
