import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';
import { maybeHandlePrivateAthenaCoder } from '@/lib/private-athena-coder';
import { SPMT_BASE_URL, refreshHmoSpmtSession } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

const STREAMWEAVER_BASE_URL = String(
  process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev',
).replace(/\/$/, '');
const HMO_ORIGIN = (() => {
  try {
    return new URL(String(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://hearmeout-main.fly.dev')).origin;
  } catch {
    return 'https://hearmeout-main.fly.dev';
  }
})();

type EmbeddedUser = {
  id: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  role?: string;
};

type HmoTokens = {
  accessToken: string;
  refreshToken: string;
};

type SharedBot = {
  id: string;
  name: string;
  ownerName?: string;
  ownerTenantId: string;
  aliases?: string[];
  wakeNames?: string[];
  voice?: string;
  canInvite?: boolean;
};

function clean(value: unknown, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function normalize(value: unknown) {
  return clean(value, 160).toLowerCase().replace(/^@/, '');
}

function assistantRoomId(userId: string) {
  const digest = createHash('sha256').update(`hmo-private-athena:${userId}`).digest('hex').slice(0, 28);
  return `private-athena-${digest}`;
}

async function exchangeLaunchCode(launchCode: string): Promise<{ user: EmbeddedUser; tokens: HmoTokens }> {
  const clientSecret = clean(process.env.HEARMEOUT_CLIENT_SECRET, 10000);
  if (!clientSecret) throw new Error('HearMeOut SPMT client secret is not configured');

  const response = await fetch(`${SPMT_BASE_URL}/api/embed/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      code: launchCode,
      client_id: 'hearmeout',
      client_secret: clientSecret,
      target_origin: HMO_ORIGIN,
    }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10000) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const message = clean(payload?.error?.message || payload?.error || `SPMT embed exchange returned ${response.status}`, 1000);
    throw new Error(message);
  }

  const user = payload?.user as EmbeddedUser | undefined;
  const accessToken = clean(payload?.access_token, 10000);
  const refreshToken = clean(payload?.refresh_token, 10000);
  if (!user?.id || !accessToken || !refreshToken) {
    throw new Error('SPMT embed exchange returned an incomplete HearMeOut session');
  }
  return { user, tokens: { accessToken, refreshToken } };
}

async function ensurePrivateRoom(user: EmbeddedUser) {
  await ensureDb();
  const roomId = assistantRoomId(user.id);
  const existing = db.get('rooms', roomId) || {};
  const now = new Date().toISOString();
  const ownerName = clean(user.displayName || user.username || user.id, 96);
  const room = {
    ...existing,
    id: roomId,
    name: existing.name || 'Athena Private Room',
    ownerId: user.id,
    ownerName,
    playlist: Array.isArray(existing.playlist) ? existing.playlist : [],
    playHistory: Array.isArray(existing.playHistory) ? existing.playHistory : [],
    isPlaying: Boolean(existing.isPlaying),
    djActive: Boolean(existing.djActive),
    autoRadio: Boolean(existing.autoRadio),
    isPrivate: true,
    password: undefined,
    expiresAt: undefined,
    systemRoom: true,
    privateAssistant: true,
    assistantPersona: 'athena',
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
  db.set('rooms', roomId, room);
  return room;
}

async function fetchCatalog(accessToken: string) {
  const response = await fetch(`${STREAMWEAVER_BASE_URL}/api/spmt/bots`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(12000) : undefined,
  });
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || 'Invalid StreamWeaver response' }; }
  return { response, payload };
}

function findAthena(bots: SharedBot[]) {
  return bots.find((bot) => {
    const names = [bot.id, bot.name, bot.ownerTenantId, ...(bot.aliases || []), ...(bot.wakeNames || [])].map(normalize);
    return bot.canInvite !== false && names.some((name) => name === 'athena' || name === 'hey athena');
  }) || null;
}

async function resolveAthena(tokens: HmoTokens) {
  let catalog = await fetchCatalog(tokens.accessToken);
  if (catalog.response.status === 401 && tokens.refreshToken) {
    const refreshed = await refreshHmoSpmtSession(tokens.refreshToken);
    if (refreshed) {
      tokens.accessToken = refreshed.accessToken;
      tokens.refreshToken = refreshed.refreshToken;
      catalog = await fetchCatalog(tokens.accessToken);
    }
  }
  if (!catalog.response.ok) {
    throw new Error(clean(catalog.payload?.error?.message || catalog.payload?.error || `StreamWeaver bot catalog returned ${catalog.response.status}`, 1000));
  }
  const bots = (catalog.payload?.data?.bots || catalog.payload?.bots || []) as SharedBot[];
  const athena = findAthena(bots);
  if (!athena) throw new Error('Athena is not available in the shared bot catalog');
  return athena;
}

async function ensurePersona(roomId: string, bot: SharedBot, tokens: HmoTokens) {
  const response = await fetch(`${getDjWorkerUrl()}/persona`, {
    method: 'POST',
    headers: getDjWorkerRequestHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify({
      action: 'join',
      roomId,
      personaId: bot.ownerTenantId,
      displayName: bot.name,
      ownerTenantId: bot.ownerTenantId,
      ownerName: bot.ownerName || '',
      wakeNames: bot.wakeNames || [bot.name, ...(bot.aliases || [])],
      aliases: bot.aliases || [],
      voice: bot.voice || '',
      spmtAccessToken: tokens.accessToken,
      spmtRefreshToken: tokens.refreshToken,
    }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20000) : undefined,
  }).catch(() => null);
  if (!response) throw new Error('Persona worker is unavailable');
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok || payload?.success === false) {
    throw new Error(clean(payload?.error || `Persona worker returned ${response.status}`, 1000));
  }
  return payload;
}

async function forwardCommand(command: string, roomId: string, bot: SharedBot, tokens: HmoTokens) {
  const send = (accessToken: string) => fetch(`${SPMT_BASE_URL}/api/bot/commands`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      command,
      roomId,
      targetTenantId: bot.ownerTenantId,
      speak: true,
      voice: bot.voice || undefined,
    }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(65000) : undefined,
  });

  let response = await send(tokens.accessToken);
  if (response.status === 401 && tokens.refreshToken) {
    const refreshed = await refreshHmoSpmtSession(tokens.refreshToken);
    if (refreshed) {
      tokens.accessToken = refreshed.accessToken;
      tokens.refreshToken = refreshed.refreshToken;
      response = await send(tokens.accessToken);
    }
  }
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || 'Invalid SPMT command response' }; }
  if (!response.ok) {
    throw new Error(clean(payload?.error?.message || payload?.error || `SPMT command bridge returned ${response.status}`, 1000));
  }
  return payload;
}

function responseData(payload: any) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

function responseText(payload: any) {
  const data = responseData(payload);
  return clean(data?.response || data?.reply || data?.text || data?.message || payload?.response || payload?.reply, 5000);
}

async function speakInRoom(roomId: string, bot: SharedBot, payload: any) {
  const data = responseData(payload);
  const audioDataUri = clean(data?.tts?.audioDataUri || payload?.tts?.audioDataUri, 30_000_000);
  if (!audioDataUri) return { spoken: false };
  const response = await fetch(`${getDjWorkerUrl()}/persona/speak`, {
    method: 'POST',
    headers: getDjWorkerRequestHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify({ roomId, personaId: bot.ownerTenantId, audioDataUri }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(30000) : undefined,
  }).catch(() => null);
  if (!response) return { spoken: false, error: 'Persona worker unavailable for TTS playback' };
  const workerPayload = await response.json().catch(() => ({}));
  return { spoken: response.ok, worker: workerPayload };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as any;
    const launchCode = clean(body?.launchCode || body?.code, 512);
    const action = normalize(body?.action || 'ensure');
    const command = clean(body?.text || body?.command || body?.transcript, 5000);
    if (!launchCode) return NextResponse.json({ ok: false, error: 'launchCode is required' }, { status: 400 });
    if (!['ensure', 'utterance'].includes(action)) {
      return NextResponse.json({ ok: false, error: 'action must be ensure or utterance' }, { status: 400 });
    }
    if (action === 'utterance' && !command) {
      return NextResponse.json({ ok: false, error: 'text is required for utterance' }, { status: 400 });
    }

    const { user, tokens } = await exchangeLaunchCode(launchCode);
    const room = await ensurePrivateRoom(user);
    const bot = await resolveAthena(tokens);
    const persona = await ensurePersona(room.id, bot, tokens);

    if (action === 'ensure') {
      return NextResponse.json({
        ok: true,
        status: 'ready',
        roomId: room.id,
        roomName: room.name,
        persistent: true,
        private: true,
        persona: { id: bot.ownerTenantId, name: bot.name, runtime: persona?.runtime || null },
      }, { headers: { 'cache-control': 'private, no-store' } });
    }

    const coder = await maybeHandlePrivateAthenaCoder({
      userId: user.id,
      text: command,
      accessToken: tokens.accessToken,
    });
    if (coder.handled) {
      return NextResponse.json({
        ok: true,
        status: 'ready',
        roomId: room.id,
        roomName: room.name,
        persistent: true,
        private: true,
        persona: { id: bot.ownerTenantId, name: bot.name },
        reply: coder.reply || '',
        response: { coder: coder.result || null },
        speech: { spoken: false, delivery: 'caller-local-tts' },
      }, { headers: { 'cache-control': 'private, no-store' } });
    }

    const result = await forwardCommand(command, room.id, bot, tokens);
    // Re-joining is idempotent and refreshes the active worker runtime's OAuth
    // credentials if the command path rotated them.
    await ensurePersona(room.id, bot, tokens);
    const speech = await speakInRoom(room.id, bot, result);
    return NextResponse.json({
      ok: true,
      status: 'ready',
      roomId: room.id,
      roomName: room.name,
      persistent: true,
      private: true,
      persona: { id: bot.ownerTenantId, name: bot.name },
      reply: responseText(result),
      response: result,
      speech,
    }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /launch|exchange|unauthor|expired|authorization required/i.test(message) ? 401 : /required|invalid|unsupported/i.test(message) ? 400 : /Only completed|Manual publication|GitHub PR/i.test(message) ? 409 : 502;
    return NextResponse.json({ ok: false, error: message }, { status, headers: { 'cache-control': 'private, no-store' } });
  }
}
