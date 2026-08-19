'use strict';

const { timingSafeEqual } = require('crypto');
const { PersonaSession } = require('./persona-session');
const { PersonaRuntimeAdapter, audioDataUriToPcm } = require('./persona-runtime-adapter');
const { setVoiceBridgeRoomOutbound } = require('./discord-voice-bridge');

const sessions = new Map();

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

function sessionKey(roomId, personaId) {
  return `${roomId}:${personaId}`;
}

function personaCountForRoom(roomId) {
  let count = 0;
  for (const record of sessions.values()) {
    if (record.roomId === roomId) count += 1;
  }
  return count;
}

async function stopRecord(record) {
  if (!record) return;
  try { record.runtime?.stop(); } catch {}
  await record.persona?.stop().catch(() => {});
}

async function mintPersonaToken({ roomId, personaId, displayName, metadata }) {
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
      persona: true,
      personaId,
      userName: displayName,
      personaMetadata: metadata,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.token) {
    throw new Error(String(payload?.error || `LiveKit token route returned ${response.status}`));
  }
  return String(payload.token);
}

async function handlePersona(req, res) {
  const action = clean(req.body?.action, 20).toLowerCase();
  const roomId = clean(req.body?.roomId, 160);
  const personaId = clean(req.body?.personaId, 96).replace(/[^A-Za-z0-9_.:-]/g, '');
  const displayName = clean(req.body?.displayName, 64) || personaId;
  if (!roomId || !personaId) return res.status(400).json({ success: false, error: 'roomId and personaId are required' });

  const key = sessionKey(roomId, personaId);
  if (action === 'leave' || action === 'stop') {
    const existing = sessions.get(key);
    if (existing) {
      await stopRecord(existing);
      sessions.delete(key);
    }
    return res.json({ success: true, action: 'leave', roomId, personaId, displayName });
  }

  if (action !== 'join' && action !== 'start') {
    return res.status(400).json({ success: false, error: 'action must be join or leave' });
  }

  if (sessions.has(key)) {
    const existing = sessions.get(key);
    if (req.body?.spmtAccessToken) existing.runtime.accessToken = clean(req.body.spmtAccessToken, 10000);
    if (req.body?.spmtRefreshToken) existing.runtime.refreshToken = clean(req.body.spmtRefreshToken, 10000);
    return res.json({
      success: true,
      action: 'join',
      alreadyJoined: true,
      roomId,
      personaId,
      displayName,
      runtime: existing.runtime.status(),
    });
  }

  const wakeNames = Array.isArray(req.body?.wakeNames) ? req.body.wakeNames.map((v) => clean(v, 96)).filter(Boolean) : [];
  const aliases = Array.isArray(req.body?.aliases) ? req.body.aliases.map((v) => clean(v, 96)).filter(Boolean) : [];
  const interests = Array.isArray(req.body?.interests) ? req.body.interests.map((v) => clean(v, 96)).filter(Boolean) : [];
  const ownerTenantId = clean(req.body?.ownerTenantId, 128) || personaId;
  const voice = clean(req.body?.voice, 128);
  const livekitTtsDescriptor = clean(req.body?.livekitTtsDescriptor, 128);
  const avatar = clean(req.body?.avatar, 1000);
  const idleAvatar = clean(req.body?.idleAvatar, 1000) || avatar;
  const talkingAvatar = clean(req.body?.talkingAvatar, 1000) || idleAvatar;
  const metadata = {
    type: 'persona',
    bot: true,
    personaId,
    displayName,
    ownerTenantId,
    ownerName: clean(req.body?.ownerName, 96),
    wakeNames,
    aliases,
    interests,
    voice,
    livekitTtsDescriptor,
    avatar,
    idleAvatar,
    talkingAvatar,
    research: req.body?.research !== false,
    source: 'streamweaver',
  };

  try {
    const token = await mintPersonaToken({ roomId, personaId, displayName, metadata });
    const livekitUrl = String(
      process.env.LIVEKIT_URL
      || process.env.NEXT_PUBLIC_LIVEKIT_URL
      || 'wss://hearmeout-6ntnbsdm.livekit.cloud',
    ).trim();
    const persona = new PersonaSession({
      roomId,
      personaId,
      displayName,
      avatar,
      livekitUrl,
      token,
      research: req.body?.research !== false,
    });
    await persona.start();

    const appUrl = String(process.env.APP_URL || 'https://hearmeout-main.fly.dev').replace(/\/$/, '');
    const secret = workerSecret();
    const runtime = new PersonaRuntimeAdapter({
      persona,
      roomId,
      personaId,
      displayName,
      ownerTenantId,
      wakeNames,
      aliases,
      interests,
      voice,
      appUrl,
      workerHeaders: { Authorization: `Bearer ${secret}` },
      accessToken: clean(req.body?.spmtAccessToken, 10000),
      refreshToken: clean(req.body?.spmtRefreshToken, 10000),
      personaCount: () => personaCountForRoom(roomId),
    });
    runtime.start();

    sessions.set(key, { roomId, personaId, persona, runtime, metadata });
    return res.json({
      success: true,
      action: 'join',
      roomId,
      personaId,
      displayName,
      runtime: runtime.status(),
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      roomId,
      personaId,
    });
  }
}

async function handlePersonaSpeak(req, res) {
  const roomId = clean(req.body?.roomId, 160);
  const personaId = clean(req.body?.personaId, 96).replace(/[^A-Za-z0-9_.:-]/g, '');
  const audioDataUri = String(req.body?.audioDataUri || '').trim();
  if (!roomId || !personaId || !audioDataUri) {
    return res.status(400).json({ success: false, error: 'roomId, personaId, and audioDataUri are required' });
  }
  const record = sessions.get(sessionKey(roomId, personaId));
  if (!record) return res.status(404).json({ success: false, error: 'Persona is not active in this room' });
  try {
    const pcm = await audioDataUriToPcm(audioDataUri);
    await record.persona.pushPcm(pcm);
    return res.json({ success: true, roomId, personaId, bytes: pcm.length });
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function installRoutes(app, express) {
  if (app.__hmoPersonaRoutesInstalled) return;
  app.__hmoPersonaRoutesInstalled = true;
  const jsonBody = express.json({ limit: '32mb' });
  app.post('/persona', jsonBody, authorize, (req, res) => {
    handlePersona(req, res).catch((error) => {
      console.error('[Persona] route failed:', error);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Persona route failed' });
    });
  });
  app.post('/persona/speak', jsonBody, authorize, (req, res) => {
    handlePersonaSpeak(req, res).catch((error) => {
      console.error('[Persona] speak failed:', error);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Persona speak failed' });
    });
  });
  app.get('/persona', authorize, (_req, res) => {
    res.json({
      instances: Array.from(sessions.values()).map((record) => ({
        roomId: record.roomId,
        personaId: record.personaId,
        runtime: record.runtime.status(),
      })),
    });
  });

  // Voice-bridge privacy is intentionally separate from persona/bot joining.
  // This route only changes whether HearMeOut room microphones are returned to
  // Discord. Discord -> HearMeOut and the music lane remain connected.
  app.post('/voice-bridge/gate', jsonBody, authorize, (req, res) => {
    const roomId = clean(req.body?.roomId, 160);
    const enabled = req.body?.roomVoiceOutboundEnabled;
    if (!roomId) return res.status(400).json({ success: false, error: 'roomId is required' });
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'roomVoiceOutboundEnabled must be boolean' });
    }
    return res.json(setVoiceBridgeRoomOutbound(roomId, enabled));
  });
}

function patchExpress() {
  const expressPath = require.resolve('express');
  const currentExpress = require(expressPath);
  if (currentExpress.__hmoPersonaFactory) return;

  function wrappedExpress(...args) {
    const app = currentExpress(...args);
    installRoutes(app, currentExpress);
    return app;
  }
  for (const key of Object.keys(currentExpress)) wrappedExpress[key] = currentExpress[key];
  wrappedExpress.__hmoPersonaFactory = true;
  require.cache[expressPath].exports = wrappedExpress;
}

patchExpress();
