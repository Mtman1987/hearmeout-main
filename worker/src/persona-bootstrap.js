'use strict';

const { timingSafeEqual } = require('crypto');
const { PersonaSession } = require('./persona-session');
const { setVoiceBridgeRoomOutbound } = require('./discord-voice-bridge');

const LOCAL_DEV_WORKER_SECRET = 'hearmeout-local-worker-development-only';
const sessions = new Map();

function workerSecret() {
  return String(process.env.HMO_WORKER_SHARED_SECRET || '').trim()
    || (process.env.NODE_ENV !== 'production' ? LOCAL_DEV_WORKER_SECRET : '');
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
      await existing.stop().catch(() => {});
      sessions.delete(key);
    }
    return res.json({ success: true, action: 'leave', roomId, personaId, displayName });
  }

  if (action !== 'join' && action !== 'start') {
    return res.status(400).json({ success: false, error: 'action must be join or leave' });
  }

  if (sessions.has(key)) {
    return res.json({ success: true, action: 'join', alreadyJoined: true, roomId, personaId, displayName });
  }

  const wakeNames = Array.isArray(req.body?.wakeNames) ? req.body.wakeNames.map((v) => clean(v, 96)).filter(Boolean) : [];
  const aliases = Array.isArray(req.body?.aliases) ? req.body.aliases.map((v) => clean(v, 96)).filter(Boolean) : [];
  const metadata = {
    type: 'persona',
    bot: true,
    personaId,
    displayName,
    ownerTenantId: clean(req.body?.ownerTenantId, 128) || personaId,
    ownerName: clean(req.body?.ownerName, 96),
    wakeNames,
    aliases,
    voice: clean(req.body?.voice, 128),
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
      avatar: clean(req.body?.avatar, 1000),
      livekitUrl,
      token,
      research: req.body?.research !== false,
    });
    await persona.start();
    sessions.set(key, persona);
    return res.json({ success: true, action: 'join', roomId, personaId, displayName });
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      roomId,
      personaId,
    });
  }
}

function installRoutes(app, express) {
  if (app.__hmoPersonaRoutesInstalled) return;
  app.__hmoPersonaRoutesInstalled = true;
  const jsonBody = express.json({ limit: '64kb' });
  app.post('/persona', jsonBody, authorize, (req, res) => {
    handlePersona(req, res).catch((error) => {
      console.error('[Persona] route failed:', error);
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Persona route failed' });
    });
  });
  app.get('/persona', authorize, (_req, res) => {
    res.json({
      instances: Array.from(sessions.keys()).map((key) => {
        const split = key.indexOf(':');
        return { roomId: key.slice(0, split), personaId: key.slice(split + 1) };
      }),
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