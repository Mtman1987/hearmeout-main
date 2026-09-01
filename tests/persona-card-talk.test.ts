import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function source(relative: string) {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
}

test('persona card reuses browser voice-reply capture and the working typed bot path', () => {
  const card = source('src/app/rooms/[roomId]/_components/PersonaCard.tsx');

  assert.match(card, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(card, /new MediaRecorder/);
  assert.match(card, /audio\/webm;codecs=opus/);
  assert.match(card, /\/api\/internal\/persona-transcribe/);
  assert.match(card, /\/api\/bot\/commands/);
  assert.match(card, /targetTenantId:\s*personaTargetId/);
  assert.match(card, /speak:\s*true/);
  assert.match(card, /You said/);
  assert.match(card, /Talk to \$\{displayName\}/);
  assert.doesNotMatch(card, /\/api\/internal\/persona-command/);
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
