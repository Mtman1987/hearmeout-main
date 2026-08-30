'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { attachSpmtRtcCanary, createTicket, verifyTicket } = require('../worker/src/spmt-rtc-canary');

const secret = 'worker-canary-secret-value-that-is-long-enough';
const tenantId = 'tenant-canary';
const roomId = 'empty-test-room';

function open(port, participantId, role, tenant = tenantId) {
  const expiresAt = Date.now() + 60_000;
  const ticket = createTicket(secret, { tenantId: tenant, roomId, participantId, role, expiresAt });
  const url = new URL(`ws://127.0.0.1:${port}/v1/hearmeout/rtc`);
  url.searchParams.set('tenantId', tenant);
  url.searchParams.set('roomId', roomId);
  url.searchParams.set('participantId', participantId);
  url.searchParams.set('role', role);
  const socket = new WebSocket(url, ['spmt-rtc-v1', ticket]);
  socket.binaryType = 'arraybuffer';
  return socket;
}
function opened(socket) { return new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); }); }
function closed(socket) { return new Promise((resolve) => socket.addEventListener('close', resolve, { once: true })); }
function message(socket) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('message timeout')), 2_000); socket.addEventListener('message', (event) => { clearTimeout(timer); resolve(new Uint8Array(event.data)); }, { once: true }); }); }
function listen(server) { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); }); }); }
function stop(server) { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

test('worker RTC canary remains disabled unless explicitly enabled', async () => {
  const server = http.createServer((req, res) => res.end('ok'));
  const relay = attachSpmtRtcCanary(server, { enabled: false });
  assert.equal(relay.enabled, false);
  const port = await listen(server);
  try {
    const socket = open(port, 'disabled-client', 'browser');
    await closed(socket);
    assert.deepEqual(relay.snapshot(), []);
  } finally { await stop(server); }
});

test('worker RTC canary relays binary frames on the existing HTTP listener', async () => {
  const server = http.createServer((req, res) => res.end('ok'));
  const relay = attachSpmtRtcCanary(server, { enabled: true, secret, tenantId, roomId });
  const port = await listen(server);
  try {
    const browser = open(port, 'browser-a', 'browser');
    const persona = open(port, 'persona-a', 'persona');
    await Promise.all([opened(browser), opened(persona)]);
    const received = message(persona);
    browser.send(new Uint8Array([9, 8, 7, 6]));
    assert.deepEqual([...await received], [9, 8, 7, 6]);
    assert.equal(relay.snapshot()[0].participantCount, 2);
    browser.close(); persona.close();
  } finally { relay.close(); await stop(server); }
});

test('worker RTC canary refuses a tenant outside the explicit fence', async () => {
  const server = http.createServer((req, res) => res.end('ok'));
  const relay = attachSpmtRtcCanary(server, { enabled: true, secret, tenantId, roomId });
  const port = await listen(server);
  try {
    const socket = open(port, 'intruder', 'browser', 'other-tenant');
    await closed(socket);
    assert.equal(relay.snapshot().length, 0);
  } finally { relay.close(); await stop(server); }
});

test('worker RTC HMAC ticket is scoped, short lived, and contains no secret', () => {
  const expiresAt = Date.now() + 60_000;
  const input = { tenantId, roomId, participantId: 'browser-a', role: 'browser', expiresAt };
  const ticket = createTicket(secret, input);
  assert.equal(verifyTicket(secret, input, ticket, Date.now()), true);
  assert.equal(verifyTicket(secret, { ...input, roomId: 'other-room' }, ticket, Date.now()), false);
  assert.equal(ticket.includes(secret), false);
  assert.equal(verifyTicket(secret, input, ticket, expiresAt + 10_000), false);
});
