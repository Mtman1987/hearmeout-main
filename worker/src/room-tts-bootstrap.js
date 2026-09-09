'use strict';

const { timingSafeEqual } = require('crypto');
const { PersonaSession } = require('./persona-session');
const { audioDataUriToPcm } = require('./persona-runtime-adapter');

// Public/channel TTS is deliberately its own output-only LiveKit publisher. It
// never joins the Discord voice bridge and never runs a persona/AI listener.
// Keeping it idle only briefly prevents a TTS control from consuming LiveKit
// connection minutes for the rest of the day.
const ROOM_TTS_IDLE_MS = Math.max(15_000, Number(process.env.HMO_ROOM_TTS_IDLE_MS || 45_000));
const roomTtsSessions = new Map();
const roomTtsStarts = new Map();

function workerSecret() {
  return String(process.env.HMO_WORKER_SHARED_SECRET || '').trim();
}

function secretsMatch(actual, expected) {
  const a = Buffer.from(String(actual || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorize(req, res, next) {
  const expected = workerSecret();
  if (!expected) return res.status(503).json({ error: 'Worker authentication is not configured' });
  const authorization = String(req.get('authorization') || '');
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!secretsMatch(supplied, expected)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function clean(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function safeIdentityPart(value, max = 72) {
  return clean(value, max).replace(/[^A-Za-z0-9_.:-]/g, '') || 'room';
}

async function mintRoomTtsToken(roomId) {
  const appUrl = String(process.env.APP_URL || 'https://hearmeout-main.fly.dev').replace(/\/$/, '');
  const secret = workerSecret();
  const response = await fetch(`${appUrl}/api/livekit-token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      roomId,
      roomTts: true,
      ttsIdentity: `room-tts:${safeIdentityPart(roomId)}`,
      userName: 'Room TTS',
      ttsMetadata: {
        type: 'system-audio',
        hidden: true,
        source: 'room-tts',
        roomId,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.token) {
    throw new Error(String(payload?.error || `Room TTS token request returned ${response.status}`));
  }
  return String(payload.token);
}

async function stopRoomTts(roomId, expectedRecord) {
  const record = roomTtsSessions.get(roomId);
  if (!record || (expectedRecord && record !== expectedRecord)) return;
  roomTtsSessions.delete(roomId);
  if (record.idleTimer) clearTimeout(record.idleTimer);
  record.idleTimer = null;
  await record.session.stop().catch(() => {});
  console.log(`[RoomTTS:${roomId}] idle publisher disconnected`);
}

function scheduleIdle(roomId, record) {
  if (record.idleTimer) clearTimeout(record.idleTimer);
  record.idleTimer = setTimeout(() => {
    stopRoomTts(roomId, record).catch((error) => {
      console.warn(`[RoomTTS:${roomId}] idle disconnect failed:`, error?.message || error);
    });
  }, ROOM_TTS_IDLE_MS);
}

async function startRoomTts(roomId) {
  const existing = roomTtsSessions.get(roomId);
  if (existing?.session?.isHealthy?.()) {
    scheduleIdle(roomId, existing);
    return existing;
  }
  if (existing) await stopRoomTts(roomId, existing);

  const inFlight = roomTtsStarts.get(roomId);
  if (inFlight) return inFlight;

  const startPromise = (async () => {
    const token = await mintRoomTtsToken(roomId);
    const livekitUrl = String(
      process.env.LIVEKIT_URL
      || process.env.NEXT_PUBLIC_LIVEKIT_URL
      || 'wss://hearmeout-6ntnbsdm.livekit.cloud',
    ).trim();
    const session = new PersonaSession({
      roomId,
      personaId: `room-tts:${safeIdentityPart(roomId)}`,
      displayName: 'Room TTS',
      avatar: '',
      livekitUrl,
      token,
      research: false,
    });
    await session.start();
    const record = {
      roomId,
      session,
      queue: Promise.resolve(),
      idleTimer: null,
      clipsPlayed: 0,
      lastSpokeAt: 0,
    };
    roomTtsSessions.set(roomId, record);
    scheduleIdle(roomId, record);
    console.log(`[RoomTTS:${roomId}] output-only publisher connected`);
    return record;
  })().finally(() => {
    roomTtsStarts.delete(roomId);
  });

  roomTtsStarts.set(roomId, startPromise);
  return startPromise;
}

async function handleRoomTtsSpeak(req, res) {
  const roomId = clean(req.body?.roomId, 160);
  const audioDataUri = String(req.body?.audioDataUri || '').trim();
  if (!roomId || !audioDataUri) {
    return res.status(400).json({ success: false, error: 'roomId and audioDataUri are required' });
  }

  try {
    let record = await startRoomTts(roomId);
    const pcm = await audioDataUriToPcm(audioDataUri);
    if (!pcm?.length) throw new Error('TTS audio decoded to an empty PCM buffer');

    const queued = record.queue.then(async () => {
      // If an earlier error caused the session to be replaced, resolve the
      // current healthy record before this clip starts.
      if (!record.session.isHealthy()) record = await startRoomTts(roomId);
      if (record.idleTimer) clearTimeout(record.idleTimer);
      record.idleTimer = null;
      await record.session.pushPcm(pcm);
      record.clipsPlayed += 1;
      record.lastSpokeAt = Date.now();
      scheduleIdle(roomId, record);
    });
    record.queue = queued.catch(() => {});
    await queued;

    return res.json({
      success: true,
      roomId,
      bytes: pcm.length,
      clipsPlayed: record.clipsPlayed,
      idleDisconnectMs: ROOM_TTS_IDLE_MS,
      transportHealthy: record.session.isHealthy(),
    });
  } catch (error) {
    console.error(`[RoomTTS:${roomId || 'unknown'}] speak failed:`, error);
    return res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      roomId,
    });
  }
}

function installRoutes(app, express) {
  if (app.__hmoRoomTtsRoutesInstalled) return;
  app.__hmoRoomTtsRoutesInstalled = true;
  const jsonBody = express.json({ limit: '32mb' });

  app.post('/room-tts/speak', jsonBody, authorize, (req, res) => {
    handleRoomTtsSpeak(req, res).catch((error) => {
      console.error('[RoomTTS] route failed:', error);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Room TTS route failed' });
    });
  });

  app.get('/room-tts', authorize, (_req, res) => {
    res.json({
      idleDisconnectMs: ROOM_TTS_IDLE_MS,
      rooms: Array.from(roomTtsSessions.values()).map((record) => ({
        roomId: record.roomId,
        transportHealthy: record.session.isHealthy(),
        clipsPlayed: record.clipsPlayed,
        lastSpokeAt: record.lastSpokeAt || null,
      })),
    });
  });
}

function patchExpress() {
  const expressPath = require.resolve('express');
  const currentExpress = require(expressPath);
  if (currentExpress.__hmoRoomTtsFactory) return;

  function wrappedExpress(...args) {
    // currentExpress may already be the persona-bootstrap wrapper. Calling it
    // first preserves all existing persona/bridge routes before adding TTS.
    const app = currentExpress(...args);
    installRoutes(app, currentExpress);
    return app;
  }
  for (const key of Object.keys(currentExpress)) wrappedExpress[key] = currentExpress[key];
  wrappedExpress.__hmoRoomTtsFactory = true;
  require.cache[expressPath].exports = wrappedExpress;
}

patchExpress();
