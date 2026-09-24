const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('worker/src/server.js', 'utf8');
const loungeProxy = fs.readFileSync('src/lib/lounge-worker.ts', 'utf8');
const spotlightProxy = fs.readFileSync('src/lib/spotlight-worker.ts', 'utf8');
const djFly = fs.readFileSync('worker/fly.toml', 'utf8');
const loungeFly = fs.readFileSync('worker/fly-lounge.toml', 'utf8');
const spotlightFly = fs.readFileSync('worker/fly-spotlight.toml', 'utf8');

test('persistent renderers are isolated by worker role', () => {
  assert.match(server, /const WORKER_ROLE = String\(process\.env\.HMO_WORKER_ROLE \|\| 'all'\)/);
  assert.match(server, /const RUN_SPOTLIGHT = WORKER_ROLE === 'all' \|\| WORKER_ROLE === 'spotlight'/);
  assert.match(server, /const RUN_LOUNGE = WORKER_ROLE === 'all' \|\| WORKER_ROLE === 'lounge'/);
  assert.match(server, /if \(RUN_SPOTLIGHT\)/);
  assert.match(server, /if \(RUN_LOUNGE\)/);
});

test('private renderer bypass is scoped only to its media surface', () => {
  assert.match(server, /function authorizeRenderer\(kind\)/);
  assert.match(server, /if \(PRIVATE_RENDERER && WORKER_ROLE === kind\) return next\(\)/);
  assert.match(server, /app\.get\('\/spotlight\/status', authorizeSpotlight/);
  assert.match(server, /app\.get\('\/lounge\/status', authorizeLounge/);
  assert.match(server, /app\.post\('\/voice-bridge\/gate', authorizeWorker/);
});

test('DJ worker no longer owns persistent renderers', () => {
  assert.match(djFly, /HMO_WORKER_ROLE = "dj"/);
});

test('Spotlight and Lounge each have a dedicated shared-CPU Fly machine', () => {
  assert.match(spotlightFly, /app = "hmo-spotlight-worker"/);
  assert.match(spotlightFly, /HMO_WORKER_ROLE = "spotlight"/);
  assert.match(spotlightFly, /cpu_kind = "shared"/);
  assert.match(spotlightFly, /memory = "4gb"/);

  assert.match(loungeFly, /app = "hmo-lounge-worker"/);
  assert.match(loungeFly, /HMO_WORKER_ROLE = "lounge"/);
  assert.match(loungeFly, /cpu_kind = "shared"/);
  assert.match(loungeFly, /memory = "4gb"/);
});

test('main app proxies media to the dedicated private workers', () => {
  assert.match(loungeProxy, /http:\/\/hmo-lounge-worker\.internal:3002/);
  assert.match(spotlightProxy, /http:\/\/hmo-spotlight-worker\.internal:3002/);
});
