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

async function publicPersonaIsInRoom(roomId: string, targetTenantId: string) {
  await ensureDb();
  const presenceId = `persona:${targetTenantId}`;
  const presence = db.get(`rooms/${roomId}/users`, presenceId);
  // The room roster is the invite authority. Do not require a LiveKit worker,
  // RTC track, or P2P participant: room bots are ordinary StreamWeaver
  // conversational personas whose speech is delivered by Say Player.
  return Boolean(
    presence
    && presence.bot === true
    && (presence.presenceKind === 'persona' || presence.personaId === targetTenantId)
  );
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
  // StreamWeaver's HearMeOut persona endpoint creates a room-scoped Say Player
  // stream key. Queue to that exact listener instead of the bot's public tenant
  // ID, or the room player will never receive the generated audio.
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
  const sayResponse = await fetch(`${STREAMWEAVER_BASE_URL}/api/say/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      tenantId: sayStreamKey || personaId,
      text: responseText,
      voice: text(body.voice, 128) || text(data?.tts?.voice, 128) || undefined,
    }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(45000) : undefined,
  }).catch(() => null);

  if (!sayResponse) {
    return { attempted: true, ok: false, error: 'StreamWeaver Say queue unavailable' };
  }
  const result = await sayResponse.json().catch(() => ({}));
  const skipped = result?.skipped === true;
  const ok = sayResponse.ok && result?.ok !== false && !skipped;
  return {
    attempted: true,
    ok,
    status: sayResponse.status,
    delivered: result?.delivered || 'say-player',
    tenantId: text(result?.tenantId, 160) || personaId,
    queued: Number.isFinite(Number(result?.queued)) ? Number(result.queued) : 0,
    ...(skipped ? { reason: text(result?.reason, 200) || 'say-player-not-listening' } : {}),
    ...(!ok ? { error: text(result?.error, 500) || (skipped
      ? 'No active StreamWeaver Say Player is listening for this persona tenant'
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
