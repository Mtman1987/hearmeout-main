import { NextRequest, NextResponse } from 'next/server';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';
import { getStreamWeaverServiceSecret } from '@/lib/bot-action-service-auth';
import { db, ensureDb } from '@/lib/db';
import {
  HMO_SPMT_COOKIE,
  HMO_SPMT_REFRESH_COOKIE,
  hmoSpmtCookieOptions,
  refreshHmoSpmtSession,
} from '@/lib/spmt-session';

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
};

function text(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max);
}

async function forwardToStreamWeaver(accessToken: string, body: BotCommandBody) {
  const command = text(body.command || body.message || body.transcript, 5000);
  const response = await fetch(`${STREAMWEAVER_BASE_URL}/api/spmt/bot/commands`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      command,
      source: 'hearmeout',
      roomId: text(body.roomId, 160) || undefined,
      targetTenantId: text(body.targetTenantId, 128) || undefined,
      speak: body.speak !== false,
      voice: text(body.voice, 128) || undefined,
    }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(65000) : undefined,
  });
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || 'Invalid StreamWeaver response' }; }
  return { response, payload };
}

async function publicPersonaIsInRoom(roomId: string, targetTenantId: string) {
  await ensureDb();
  const presenceId = `persona:${targetTenantId}`;
  const presence = db.get(`rooms/${roomId}/users`, presenceId) as any;
  return Boolean(
    presence
    && presence.bot === true
    && text(presence.personaId, 128) === targetTenantId,
  );
}

async function forwardPublicRoomPersona(body: BotCommandBody) {
  const command = text(body.command || body.message || body.transcript, 5000);
  const roomId = text(body.roomId, 160);
  const targetTenantId = text(body.targetTenantId, 128);
  const secret = getStreamWeaverServiceSecret();
  const response = await fetch(`${STREAMWEAVER_BASE_URL}/api/internal/hearmeout/persona-command`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      command,
      roomId,
      targetTenantId,
      voice: text(body.voice, 128) || undefined,
      actorUsername: 'HearMeOut visitor',
      actorDisplayName: 'HearMeOut visitor',
      actorRole: 'guest',
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

function workerSpeechDiagnostic(result: any, roomId: string, personaId: string) {
  const bytes = Number(result?.bytes);
  return {
    roomId: text(result?.roomId, 160) || roomId,
    personaId: text(result?.personaId, 128) || personaId,
    bytes: Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined,
    transportHealthy: result?.transportHealthy === true,
  };
}

async function speakThroughPersona(body: BotCommandBody, payload: any) {
  if (body.speak === false) return { attempted: false, reason: 'speech-disabled' };
  const roomId = text(body.roomId, 160);
  const data = payloadData(payload);
  const personaId = text(
    data?.bot?.tenantId || payload?.bot?.tenantId || body.targetTenantId,
    128,
  );
  const audioDataUri = text(
    data?.tts?.audioDataUri || payload?.tts?.audioDataUri,
    30_000_000,
  );
  if (!roomId || !personaId || !audioDataUri) {
    return {
      attempted: false,
      reason: 'persona-or-audio-missing',
      diagnostic: {
        roomIdPresent: !!roomId,
        personaIdPresent: !!personaId,
        audioPresent: !!audioDataUri,
      },
    };
  }

  const workerUrl = getDjWorkerUrl();
  const workerResponse = await fetch(`${workerUrl}/persona/speak`, {
    method: 'POST',
    headers: getDjWorkerRequestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ roomId, personaId, audioDataUri }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(45000) : undefined,
  }).catch(() => null);

  if (!workerResponse) return { attempted: true, ok: false, error: 'Persona worker unavailable' };
  const result = await workerResponse.json().catch(() => ({}));
  const worker = workerSpeechDiagnostic(result, roomId, personaId);
  return workerResponse.ok
    ? { attempted: true, ok: true, status: workerResponse.status, worker }
    : {
        attempted: true,
        ok: false,
        status: workerResponse.status,
        error: text(result?.error, 500),
        worker,
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
  let accessToken = text(request.cookies.get(HMO_SPMT_COOKIE)?.value, 10000);
  let refreshed: Awaited<ReturnType<typeof refreshHmoSpmtSession>> = null;
  let upstream: Awaited<ReturnType<typeof forwardToStreamWeaver>>;

  const usePublicRoomPersona = async () => {
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
    try {
      return await forwardPublicRoomPersona(commandBody);
    } catch (error) {
      console.warn('[Bot Commands] Public HearMeOut persona service unavailable:', error);
      return NextResponse.json(
        { error: 'Public bot service is unavailable' },
        { status: 502 },
      );
    }
  };

  if (accessToken) {
    upstream = await forwardToStreamWeaver(accessToken, commandBody);
    if (upstream.response.status === 401) {
      const refreshToken = text(request.cookies.get(HMO_SPMT_REFRESH_COOKIE)?.value, 10000);
      refreshed = refreshToken ? await refreshHmoSpmtSession(refreshToken) : null;
      if (refreshed) {
        accessToken = refreshed.accessToken;
        upstream = await forwardToStreamWeaver(accessToken, commandBody);
      } else {
        const publicFallback = await usePublicRoomPersona();
        if (publicFallback instanceof NextResponse) return publicFallback;
        upstream = publicFallback;
      }
    }
  } else {
    const publicFallback = await usePublicRoomPersona();
    if (publicFallback instanceof NextResponse) return publicFallback;
    upstream = publicFallback;
  }

  let personaSpeech: any = undefined;
  if (upstream.response.ok) {
    try {
      personaSpeech = await speakThroughPersona(commandBody, upstream.payload);
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
  const response = NextResponse.json(responsePayload, { status: upstream.response.status });
  response.headers.set('cache-control', 'private, no-store');

  if (refreshed) {
    response.cookies.set(HMO_SPMT_COOKIE, refreshed.accessToken, {
      ...hmoSpmtCookieOptions,
      maxAge: refreshed.expiresIn,
    });
    response.cookies.set(HMO_SPMT_REFRESH_COOKIE, refreshed.refreshToken, {
      ...hmoSpmtCookieOptions,
      maxAge: refreshed.refreshExpiresIn,
    });
  }

  return response;
}
