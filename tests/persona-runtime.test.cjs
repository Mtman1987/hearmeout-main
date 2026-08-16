'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  isHumanRoomIdentity,
  rmsPcm16,
  shouldRouteTranscript,
  wakeNameMatches,
} = require('../worker/src/persona-runtime-adapter');

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

test('single invited persona accepts ordinary room conversation', () => {
  assert.equal(shouldRouteTranscript('hey', ['Athena', 'Annie'], true), true);
  assert.equal(shouldRouteTranscript('what do you think?', ['Athena'], true), true);
  assert.equal(shouldRouteTranscript('Could not understand audio.', ['Athena'], true), false);
});

test('multiple personas require an explicit wake name', () => {
  assert.equal(shouldRouteTranscript('hey', ['Athena', 'Annie'], false), false);
  assert.equal(shouldRouteTranscript('hey Athena, are you there?', ['Athena', 'Annie'], false), true);
  assert.equal(wakeNameMatches('@Annie hello', ['Athena', 'Annie']), true);
});

test('persona runtime ignores bridge, bot, DJ, music, and listener identities', () => {
  assert.equal(isHumanRoomIdentity('user_d696355b'), true);
  for (const identity of ['persona:athena', 'discord-mixed-room', 'discord-bridge-x', 'dj-worker-room', 'dj-user', 'music-bot', 'listener-user']) {
    assert.equal(isHumanRoomIdentity(identity), false, identity);
  }
});

test('voice activity energy helper distinguishes silence from speech PCM', () => {
  const silence = Buffer.alloc(1920);
  const speech = Buffer.alloc(1920);
  for (let i = 0; i < speech.length; i += 2) speech.writeInt16LE(i % 4 ? 1800 : -1800, i);
  assert.equal(rmsPcm16(silence), 0);
  assert.ok(rmsPcm16(speech) > 1000);
});

test('room chat defaults to one invited persona and asks it to speak', () => {
  const chat = source('src/app/rooms/[roomId]/_components/ChatBox.tsx');
  assert.match(chat, /bots\.length === 1[\s\S]{0,160}!value\.trim\(\)\.startsWith\("!"\)/);
  assert.match(chat, /speak:\s*true/);
  assert.doesNotMatch(chat, /speak:\s*false/);
});

test('persona invite passes SPMT session only server-to-server and worker has a speech endpoint', () => {
  const sessionRoute = source('src/app/api/bots/session/route.ts');
  const bootstrap = source('worker/src/persona-bootstrap.js');
  const commandRoute = source('src/app/api/bot/commands/route.ts');
  assert.match(sessionRoute, /spmtAccessToken:/);
  assert.match(sessionRoute, /spmtRefreshToken:/);
  assert.match(bootstrap, /app\.post\('\/persona\/speak'/);
  assert.match(commandRoute, /\/persona\/speak/);
});
