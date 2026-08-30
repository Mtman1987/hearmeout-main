'use strict';

const { createHash, createHmac, timingSafeEqual } = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const RTC_PATH = '/v1/hearmeout/rtc';
const ROLES = new Set(['browser', 'discord-bridge', 'persona', 'music']);

function attachSpmtRtcCanary(server, options = {}) {
  if (!server || typeof server.on !== 'function') throw new Error('SPMT RTC requires an HTTP server');
  const enabled = options.enabled === true;
  if (!enabled) return { enabled: false, close() {}, snapshot: () => [] };
  const secret = requiredSecret(options.secret);
  const tenantId = clean(options.tenantId, 'tenantId');
  const roomId = clean(options.roomId, 'roomId');
  const hub = new RelayHub();
  const onUpgrade = (request, socket, head) => {
    try { upgrade(request, socket, head, { secret, tenantId, roomId, hub }); }
    catch { destroy(socket); }
  };
  server.on('upgrade', onUpgrade);
  const prune = setInterval(() => hub.prune(), 15000); prune.unref();
  return {
    enabled: true,
    snapshot: () => hub.snapshot(),
    close() { clearInterval(prune); server.off('upgrade', onUpgrade); },
  };
}

function upgrade(request, socket, head, fence) {
  const url = new URL(request.url || '/', 'http://rtc.local');
  if (url.pathname !== RTC_PATH) return reject(socket, 404, 'Not Found');
  if (String(request.headers.upgrade || '').toLowerCase() !== 'websocket') return reject(socket, 400, 'Bad Request');
  const connections = String(request.headers.connection || '').toLowerCase().split(',').map((value) => value.trim());
  if (!connections.includes('upgrade')) return reject(socket, 400, 'Bad Request');
  if (request.headers['sec-websocket-version'] !== '13') return reject(socket, 426, 'Upgrade Required');
  const key = String(request.headers['sec-websocket-key'] || '');
  if (!/^[A-Za-z0-9+/]{22}==$/.test(key)) return reject(socket, 400, 'Bad Request');
  const protocols = String(request.headers['sec-websocket-protocol'] || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!protocols.includes('spmt-rtc-v1')) return reject(socket, 400, 'SPMT RTC protocol required');
  const ticket = protocols.find((value) => value.startsWith('spmt-rtc-auth.'));
  const input = {
    tenantId: clean(url.searchParams.get('tenantId'), 'tenantId'),
    roomId: clean(url.searchParams.get('roomId'), 'roomId'),
    participantId: clean(url.searchParams.get('participantId'), 'participantId'),
    role: role(url.searchParams.get('role')),
    expiresAt: ticketExpiry(ticket),
  };
  if (input.tenantId !== fence.tenantId || input.roomId !== fence.roomId) return reject(socket, 403, 'Canary fence mismatch');
  if (!ticket || !verifyTicket(fence.secret, input, ticket)) return reject(socket, 401, 'Unauthorized');
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\nSec-WebSocket-Protocol: spmt-rtc-v1\r\n\r\n');
  const peer = new ServerSocket(socket, head);
  fence.hub.join(input, peer);
}

class RelayHub {
  constructor() { this.rooms = new Map(); }
  join(input, socket) {
    const key = input.tenantId + ':' + input.roomId;
    let room = this.rooms.get(key);
    if (!room) { room = new RelayRoom(key); this.rooms.set(key, room); }
    room.join(input.participantId, input.role, socket);
  }
  prune() { const now = Date.now(); for (const [key, room] of this.rooms) if (room.emptySince && now - room.emptySince > 60000) this.rooms.delete(key); }
  snapshot() { return [...this.rooms.values()].map((room) => room.snapshot()); }
}

class RelayRoom {
  constructor(key) { this.key = key; this.participants = new Map(); this.emptySince = 0; }
  join(id, roleName, socket) {
    if (!this.participants.has(id) && this.participants.size >= 32) { socket.close(4409, 'SPMT RTC room is full'); return; }
    const prior = this.participants.get(id); if (prior) prior.socket.close(4001, 'replaced by newer SPMT RTC connection');
    const state = { id, role: roleName, socket, started: Date.now(), frames: 0, dropped: 0 };
    this.participants.set(id, state); this.emptySince = 0;
    socket.onBinary((frame) => this.publish(state, frame));
    socket.onClose(() => { if (this.participants.get(id) === state) this.participants.delete(id); if (!this.participants.size) this.emptySince = Date.now(); });
  }
  publish(sender, frame) {
    if (!this.participants.has(sender.id)) return;
    if (!(frame instanceof Uint8Array) || !frame.byteLength || frame.byteLength > 65536) return sender.socket.close(4400, 'invalid audio frame');
    const now = Date.now(); if (now - sender.started >= 1000) { sender.started = now; sender.frames = 0; }
    sender.frames += 1; if (sender.frames > 100) { sender.dropped += 1; return; }
    for (const target of this.participants.values()) { if (target === sender) continue; try { if (target.socket.send(frame) === false) target.dropped += 1; } catch { target.dropped += 1; } }
  }
  snapshot() { return { roomKey: this.key, participantCount: this.participants.size, participants: [...this.participants.values()].map(({ id, role, dropped }) => ({ participantId: id, role, droppedFrames: dropped })) }; }
}

class ServerSocket {
  constructor(socket, head) {
    this.socket = socket; this.buffer = Buffer.alloc(0); this.binary = () => {}; this.closed = () => {}; this.ended = false;
    socket.on('data', (chunk) => this.feed(chunk)); socket.on('close', () => this.finish()); socket.on('error', () => this.finish());
    if (head && head.length) this.feed(head);
  }
  send(data) { if (this.ended || this.socket.destroyed) return false; const payload = Buffer.from(data); if (payload.length > 65536) return false; const ok = this.socket.write(encodeFrame(0x2, payload)); return ok && this.socket.writableLength < 1024 * 1024; }
  close(code = 1000, reason = '') { if (this.ended) return; this.ended = true; const text = Buffer.from(String(reason).slice(0, 100)); const payload = Buffer.alloc(2 + text.length); payload.writeUInt16BE(code, 0); text.copy(payload, 2); try { this.socket.end(encodeFrame(0x8, payload)); } catch { destroy(this.socket); } this.closed(); }
  onBinary(handler) { this.binary = handler; }
  onClose(handler) { this.closed = handler; }
  finish() { if (this.ended) return; this.ended = true; this.closed(); }
  feed(chunk) { if (this.ended) return; this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]); while (this.parse()) {} }
  parse() {
    const data = this.buffer; if (data.length < 2) return false;
    const fin = (data[0] & 0x80) !== 0, rsv = data[0] & 0x70, opcode = data[0] & 0x0f, masked = (data[1] & 0x80) !== 0;
    let length = data[1] & 0x7f, offset = 2;
    if (!fin || rsv || !masked) return this.protocolClose(1002, 'Unsupported frame');
    if (length === 126) { if (data.length < 4) return false; length = data.readUInt16BE(2); offset = 4; }
    else if (length === 127) { if (data.length < 10) return false; const large = data.readBigUInt64BE(2); if (large > 65536n) return this.protocolClose(1009, 'Frame too large'); length = Number(large); offset = 10; }
    if (length > 65536) return this.protocolClose(1009, 'Frame too large');
    if (data.length < offset + 4 + length) return false;
    const mask = data.subarray(offset, offset + 4); offset += 4; const payload = Buffer.from(data.subarray(offset, offset + length));
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index & 3];
    this.buffer = data.subarray(offset + length);
    if (opcode === 0x2) { this.binary(payload); return true; }
    if (opcode === 0x8) { this.close(1000, ''); return false; }
    if (opcode === 0x9) { this.socket.write(encodeFrame(0xA, payload)); return true; }
    if (opcode === 0xA) return true;
    return this.protocolClose(1003, 'Binary audio only');
  }
  protocolClose(code, reason) { this.close(code, reason); return false; }
}

function createTicket(secret, input) { const value = normalizedTicket(secret, input); return `spmt-rtc-auth.${value.expiresAt}.${signature(secret, value)}`; }
function verifyTicket(secret, input, ticket, now = Date.now()) {
  const value = normalizedTicket(secret, input); const match = /^spmt-rtc-auth\.(\d{10,16})\.([A-Za-z0-9_-]{32,128})$/.exec(String(ticket || ''));
  if (!match || Number(match[1] || '') !== value.expiresAt || value.expiresAt < now - 5000 || value.expiresAt > now + 120000) return false;
  const expected = Buffer.from(signature(secret, value)), supplied = Buffer.from(match[2] || ''); return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
function signature(secret, input) { return createHmac('sha256', secret).update([input.tenantId, input.roomId, input.participantId, input.role, String(input.expiresAt)].join('\n')).digest('base64url'); }
function normalizedTicket(secret, input) { requiredSecret(secret); const value = { tenantId: clean(input.tenantId, 'tenantId'), roomId: clean(input.roomId, 'roomId'), participantId: clean(input.participantId, 'participantId'), role: role(input.role), expiresAt: Math.trunc(Number(input.expiresAt)) }; if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt < 1000000000000) throw new Error('SPMT RTC expiry is invalid'); return value; }
function requiredSecret(value) { const secret = String(value || ''); if (secret.length < 32 || /[\r\n\0]/.test(secret)) throw new Error('SPMT_RTC_CANARY_SECRET must be 32+ characters'); return secret; }
function ticketExpiry(ticket) { const match = /^spmt-rtc-auth\.(\d{10,16})\./.exec(String(ticket || '')); return match ? Number(match[1]) : 0; }
function clean(value, name) { const text = String(value || '').trim(); if (!text || text.length > 160 || /[\r\n\0]/.test(text)) throw new Error(`${name} is invalid`); return text; }
function role(value) { if (!ROLES.has(value)) throw new Error('SPMT RTC role is invalid'); return value; }
function encodeFrame(opcode, payload) { const length = payload.length; let header; if (length < 126) header = Buffer.from([0x80 | opcode, length]); else if (length <= 65535) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(length, 2); } else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); } return Buffer.concat([header, payload]); }
function reject(socket, status, message) { try { socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { destroy(socket); } }
function destroy(socket) { try { socket.destroy(); } catch {} }

module.exports = { attachSpmtRtcCanary, createTicket, verifyTicket };
