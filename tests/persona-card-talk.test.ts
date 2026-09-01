import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function source(relative: string) {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
}

test('persona card keeps the working manual recorder as a fallback but shares the canonical STT and bot client', () => {
  const card = source('src/app/rooms/[roomId]/_components/PersonaCard.tsx');
  const client = source('src/lib/room-persona-client.ts');

  assert.match(card, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(card, /new MediaRecorder/);
  assert.match(card, /audio\/webm;codecs=opus/);
  assert.match(card, /transcribeRoomPersonaAudio/);
  assert.match(card, /sendRoomPersonaCommand/);
  assert.match(card, /You said/);
  assert.match(card, /Talk to \$\{displayName\}/);
  assert.match(card, /Fallback button/);
  assert.doesNotMatch(card, /fetch\('\/api\/internal\/persona-transcribe'/);
  assert.doesNotMatch(card, /fetch\('\/api\/bot\/commands'/);
  assert.match(client, /\/api\/internal\/persona-transcribe/);
  assert.match(client, /\/api\/bot\/commands/);
  assert.match(client, /speak:\s*true/);
});

test('public persona transcription does not demand another user session', () => {
  const route = source('src/app/api/internal/persona-transcribe/route.ts');

  assert.doesNotMatch(route, /getSession/);
  assert.doesNotMatch(route, /isDjWorkerRequest/);
  assert.doesNotMatch(route, /Unauthorized/);
  assert.match(route, /\/api\/speech\/transcribe/);
  assert.match(route, /MAX_AUDIO_BASE64_LENGTH/);
});

test('public room persona chat uses the public service route with no user token or StreamWeaver secret', () => {
  const route = source('src/app/api/bot/commands/route.ts');

  assert.match(route, /forwardPublicRoomPersona/);
  assert.match(route, /\/api\/internal\/hearmeout\/persona-command/);
  assert.match(route, /publicPersonaIsInRoom/);
  assert.match(route, /healthyWorkerPersona/);
  assert.match(route, /persona:\$\{targetTenantId\}/);
  assert.match(route, /StreamWeaver bearer secret/);
  assert.doesNotMatch(route, /getStreamWeaverServiceSecret|STREAMWEAVER_SECRET/);
  assert.doesNotMatch(route, /Authorization:\s*`Bearer/);
  assert.doesNotMatch(route, /accessToken|refreshToken/);
  assert.doesNotMatch(route, /HMO_SPMT_COOKIE|HMO_SPMT_REFRESH_COOKIE/);
  assert.doesNotMatch(route, /refreshHmoSpmtSession/);
  assert.doesNotMatch(route, /\/api\/spmt\/bot\/commands/);
  assert.doesNotMatch(route, /Sign in with SPMT/);
});

test('HearMeOut middleware never asks for SPMT again on public persona interaction', () => {
  const middleware = source('src/middleware.ts');
  const publicCheck = middleware.indexOf('PUBLIC_PREFIXES.some');
  const identityCheck = middleware.indexOf('resolveIdentity(request)');

  assert.ok(publicCheck >= 0 && identityCheck > publicCheck, 'public route bypass must run before SPMT identity lookup');
  for (const route of [
    '/api/bots',
    '/api/bot/commands',
    '/api/athena/commands',
    '/api/internal/persona-transcribe',
    '/api/internal/persona-command',
  ]) {
    assert.ok(middleware.includes(`'${route}'`), `${route} must bypass SPMT user-session middleware`);
  }
});
