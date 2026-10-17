import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';
import { db, ensureDb } from '@/lib/db';

const STREAMWEAVER_BASE_URL = String(
  process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev',
).replace(/\/$/, '');

type BotCommandBody = {
  command?: unknown;
  message?: unknown;
  transcript?: unknown;
  roomId?: unknown;
  targetTenantId?: unknown;
  speak?: unknown;
  voice?: unknown;
  actorIdentity?: unknown;
  actorUsername?: unknown;
  actorDisplayName?: unknown;
};

type WorkerPersonaInstance = {
  roomId?: unknown;
  personaId?: unknown;
  transportHealthy?: unknown;
  runtime?: {
    displayName?: unknown;
    wakeNames?: unknown;
    wakePolicy?: unknown;
  };
};

function text(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max);
}

async function resolvePublicActor(body: BotCommandBody) {
  let sessionUser: any = null;
  try {
    sessionUser = (await getSession())?.user || null;
  } catch {
    // Public persona conversation must still work without a browser session.
  }

  const identity = text(sessionUser?.uid || body.actorIdentity, 160);
  let storedUser: any = {};
  if (identity) {
    try {
      await ensureDb();
      storedUser = db.get('users', identity) || {};
    } catch {
      storedUser = {};
    }
  }

  const actorUsername = text(
    storedUser.username
      || storedUser.twitchUsername
      || storedUser.displayName
      || sessionUser?.displayName
      || body.actorUsername
      || body.actorDisplayName
      || 'Guest',
    100,
  );
  const actorDisplayName = text(
    storedUser.displayName
      || storedUser.username
      || storedUser.twitchUsername
      || sessionUser?.displayName
      || body.actorDisplayName
      || body.actorUsername
      || actorUsername,
    100,
  );
  const actorUserId = text(
    storedUser.discordId
      || storedUser.twitchId
      || storedUser.spmtUserId
      || sessionUser?.discordId
      || sessionUser?.twitchId
      || identity,
    160,
  );

  return { actorUserId, actorUsername, actorDisplayName };
}

async function healthyWorkerPersona(roomId: string, targetTenantId: string): Promise<WorkerPersonaInstance | null> {
  const response = await fetch(`${getDjWorkerUrl()}/persona`, {
    method: 'GET',
    headers: getDjWorkerRequestHeaders({ Accept: 'application/json' }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(6000) : undefined,
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => ({}));
  const instances = Array.isArray(payload?.instances) ? payload.instances as WorkerPersonaInstance[] : [];
  return instances.find((instance) =>
    text(instance?.roomId, 160) === roomId
    && text(instance?.personaId, 128) === targetTenantId
    && instance?.transportHealthy === true,
  ) || null;
}

async function publicPersonaIsInRoom(roomId: string, targetTenantId: string) {
  await ensureDb();
  const presenceId = `persona:${targetTenantId}`;

  // The RTC worker is authoritative. A SQLite row can be pruned, stale, or
  // left behind after a worker restart; none of those should lie about whether
  // the persona is actually connected and publishable right now.
  const instance = await healthyWorkerPersona(roomId, targetTenantId);
  const existingPresence = db.get(`rooms/${roomId}/users`, presenceId);
  if (!instance) {
    // The room may intentionally be in Say Player fallback mode after a LiveKit
    // join failure. That mode supports public typed/local-wake commands and
    // broadcast speech, but does not claim a healthy RTC persona track.
    if (existingPresence?.speechMode === 'say-player') {
      db.set(`rooms/${roomId}/users`, presenceId, {
        ...existingPresence,
        persistent: true,
        transportHealthy: false,
        lastSeen: Date.now(),
      }, { merge: true });
      return true;
    }
    db.delete(`rooms/${roomId}/users`, presenceId);
    return false;
  }

  // Self-heal/upgrade the convenience presence row from the real live session.
  // Persona replies use Say Player even when the LiveKit input transport is healthy.
  db.set(`rooms/${roomId}/users`, presenceId, {
    id: presenceId,
    uid: presenceId,
    displayName: text(instance.runtime?.displayName, 96) || targetTenantId,
    bot: true,
    personaId: targetTenantId,
    presenceKind: 'persona',
    persistent: true,
    transportHealthy: true,
    speechMode: 'say-player',
    lastSeen: Date.now(),
  }, { merge: true });
  return true;
}

async function forwardPublicRoomPersona(body: BotCommandBody) {
  const command = text(body.command || body.message || body.transcript, 5000);
  const roomId = text(body.roomId, 160);
  const targetTenantId = text(body.targetTenantId, 128);
  const actor = await resolvePublicActor(body);
  const response = await fetch(`${STREAMWEAVER_BASE_URL}/api/internal/hearmeout/persona-command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      command,
      roomId,
      targetTenantId,
      voice: text(body.voice, 128) || undefined,
      // HearMeOut queues the final response through /api/say/queue after this
      // endpoint returns; do not synthesize a second, unused audio payload here.
      speak: false,
      ...actor,
    }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(65000) : undefined,
  });
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || 'Invalid StreamWeaver response' }; }
  return { response, payload };
}

function payloadData(payload: any) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

async function speakThroughSayPlayer(body: BotCommandBody, payload: any) {
  if (body.speak === false) return { attempted: false, reason: 'speech-disabled' };

  const data = payloadData(payload);
  const personaId = text(
    data?.bot?.tenantId || payload?.bot?.tenantId || body.targetTenantId,
    128,
  );
  // Prefer the room-specific listener, with a safe fallback to the established
  // public persona stream when no room-scoped Say Player is actively listening.
  const sayStreamKey = text(data?.tts?.streamKey || payload?.tts?.streamKey, 128);
  const responseText = text(data?.response || payload?.response, 2000);
  if (!personaId || !responseText) {
    return {
      attempted: false,
      reason: 'persona-or-response-missing',
      diagnostic: { personaIdPresent: !!personaId, responsePresent: !!responseText },
    };
  }

  // Use the same StreamWeaver Say queue as !say instead of publishing persona
  // audio to the LiveKit RTC track. StreamWeaver's active Say Player is the
  // canonical browser-source broadcast path.
  // Prefer the room-scoped listener, but older/OBS setups may only have the
  // persona's public Say Player active. Retry only when the first queue explicitly
  // reports no listener, so a successful room queue is never duplicated.
  const queueSpeech = async (tenantId: string) => {
    const response = await fetch(`${STREAMWEAVER_BASE_URL}/api/say/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        tenantId,
        text: responseText,
        voice: text(body.voice, 128) || text(data?.tts?.voice, 128) || undefined,
      }),
      cache: 'no-store',
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(45000) : undefined,
    }).catch(() => null);
    if (!response) return { response: null, result: {}, skipped: false };
    const result = await response.json().catch(() => ({}));
    return { response, result, skipped: result?.skipped === true };
  };

  let deliveryTenantId = sayStreamKey || personaId;
  let queuedResult = await queueSpeech(deliveryTenantId);
  if (queuedResult.skipped && sayStreamKey && personaId && sayStreamKey !== personaId) {
    deliveryTenantId = personaId;
    queuedResult = await queueSpeech(deliveryTenantId);
  }

  const sayResponse = queuedResult.response;
  const result = queuedResult.result;
  const skipped = queuedResult.skipped;
  if (!sayResponse) {
    return { attempted: true, ok: false, tenantId: deliveryTenantId, error: 'StreamWeaver Say queue unavailable' };
  }
  const ok = sayResponse.ok && result?.ok !== false && !skipped;
  return {
    attempted: true,
    ok,
    status: sayResponse.status,
    delivered: result?.delivered || 'say-player',
    tenantId: text(result?.tenantId, 160) || deliveryTenantId,
    queued: Number.isFinite(Number(result?.queued)) ? Number(result.queued) : 0,
    ...(skipped ? { reason: text(result?.reason, 200) || 'say-player-not-listening' } : {}),
    ...(!ok ? { error: text(result?.error, 500) || (skipped
      ? 'No active StreamWeaver Say Player is listening for either the room or persona stream'
      : 'StreamWeaver Say queue rejected the speech') } : {}),
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as BotCommandBody | null;
  const command = text(body?.command || body?.message || body?.transcript, 5000);
  if (!command) {
    return NextResponse.json({ error: 'command is required' }, { status: 400 });
  }

  const commandBody = { ...(body || {}), command };
  const roomId = text(commandBody.roomId, 160);
  const targetTenantId = text(commandBody.targetTenantId, 128);
  if (!roomId || !targetTenantId) {
    return NextResponse.json(
      { error: 'An active room persona is required for public bot conversation' },
      { status: 400 },
    );
  }
  if (!await publicPersonaIsInRoom(roomId, targetTenantId)) {
    return NextResponse.json(
      { error: 'That persona is not active in this room' },
      { status: 403 },
    );
  }

  // GLOBAL INVARIANT: a persona that is present in the room is a public
  // chatbot. A browser session may enrich the actor's real display name, but
  // missing SPMT auth, Bot Share mode, owner credentials, or a StreamWeaver bearer secret
  // never blocks the human from talking to the joined persona.
  let upstream: Awaited<ReturnType<typeof forwardPublicRoomPersona>>;
  try {
    upstream = await forwardPublicRoomPersona(commandBody);
  } catch (error) {
    console.warn('[Bot Commands] Public HearMeOut persona service unavailable:', error);
    return NextResponse.json({ error: 'Public bot service is unavailable' }, { status: 502 });
  }

  let personaSpeech: any = undefined;
  if (upstream.response.ok) {
    try {
      personaSpeech = await speakThroughSayPlayer(commandBody, upstream.payload);
    } catch (error) {
      personaSpeech = {
        attempted: true,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      console.warn('[Bot Commands] Persona speech handoff failed:', personaSpeech.error);
    }
  }

  const responsePayload = personaSpeech
    ? { ...upstream.payload, personaSpeech }
    : upstream.payload;
  return NextResponse.json(responsePayload, {
    status: upstream.response.status,
    headers: { 'cache-control': 'private, no-store' },
  });
}
