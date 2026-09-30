const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const control = fs.readFileSync('worker/src/restream-control.js', 'utf8');
const server = fs.readFileSync('worker/src/server.js', 'utf8');
const route = fs.readFileSync('src/app/api/internal/restream-control/route.ts', 'utf8');
const middleware = fs.readFileSync('src/middleware.ts', 'utf8');
const fly = fs.readFileSync('worker/fly.toml', 'utf8');

test('Restream controller is persistent, origin-bounded and label-bounded', () => {
  assert.match(control, /\/data\/restream-chromium/);
  assert.match(control, /host === 'restream\.io' \|\| host\.endsWith\('\.restream\.io'\)/);
  assert.match(control, /Expected exactly one recognized Restream control/);
  assert.match(control, /\^go live\$/i);
  assert.match(control, /\^end stream\$/i);
  assert.doesNotMatch(control, /mouse\.click/);
  assert.doesNotMatch(control, /document\.querySelector\('button'\)\.click/);
});

test('Restream start and reset remain behind worker auth and the main service-auth proxy', () => {
  assert.match(server, /app\.get\('\/restream\/status', authorizeWorker/);
  assert.match(server, /app\.post\('\/restream\/start', authorizeWorker/);
  assert.match(server, /app\.post\('\/restream\/reset', authorizeWorker/);
  assert.match(control, /Restream start requires a recognized offline state/);
  assert.match(route, /action !== 'start' && action !== 'reset'/);
  assert.match(route, /SPMT_API_KEY/);
  assert.match(route, /getDjWorkerRequestHeaders/);
  assert.match(route, /http:\/\/lounge\.process\.hmo-dj-worker\.internal:3002/);
  assert.match(middleware, /\/api\/internal\/restream-control/);
});

test('Restream profile persists but automation starts fail-closed', () => {
  assert.match(fly, /RESTREAM_PROFILE_DIR = "\/data\/restream-chromium"/);
  assert.match(fly, /RESTREAM_AUTOMATION_ENABLED = "false"/);
});
