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

test('existing persona transcription endpoint accepts signed-in room clients without removing worker auth', () => {
  const route = source('src/app/api/internal/persona-transcribe/route.ts');

  assert.match(route, /isDjWorkerRequest/);
  assert.match(route, /getSession/);
  assert.match(route, /!workerRequest && !session/);
  assert.match(route, /\/api\/speech\/transcribe/);
});
