import { NextRequest, NextResponse } from 'next/server';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';
import {
  HMO_SPMT_COOKIE,
  HMO_SPMT_REFRESH_COOKIE,
  SPMT_BASE_URL,
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

type UpstreamResult = {
  response: Response;
  payload: any;
  source: 'streamweaver' | 'spmt';
};

function text(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max);
}

function requestBody(body: BotCommandBody) {
  return {
    command: text(body.command || body.message || body.transcript, 5000),
    source: 'hearmeout',
    roomId: text(body.roomId, 160) || undefined,
    targetTenantId: text(body.targetTenantId, 128) || undefined,
    speak: body.speak !== false,
    voice: text(body.voice, 128) || undefined,
  };
}

async function postBotCommand(url: string, accessToken: string, body: BotCommandBody, source: UpstreamResult['source']): Promise<UpstreamResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(requestBody(body)),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(65000) : undefined,
  });
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || `Invalid ${source} response` }; }
  return { response, payload, source };
}

async function forwardBotCommand(accessToken: string, body: BotCommandBody): Promise<UpstreamResult> {
  let direct: UpstreamResult | null = null;
  try {
    direct = await postBotCommand(
      `${STREAMWEAVER_BASE_URL}/api/spmt/bot/commands`,
      accessToken,
      body,
      'streamweaver',
    );
  } catch (error) {
    console.warn('[Bot Commands] Direct StreamWeaver request failed; trying SPMT bridge:', error);
  }

  // Authentication errors should be returned to the refresh path rather than
  // hidden by fallback. For network failures and server-side 5xx responses,
  // use the long-standing SPMT bridge as a compatibility path.
  if (direct && direct.response.status < 500) return direct;

  try {
    const bridged = await postBotCommand(
      `${SPMT_BASE_URL}/api/bot/commands`,
      accessToken,
      body,
      'spmt',
    );
    if (bridged.response.ok || !direct) return bridged;
    return direct;
  } catch (error) {
    if (direct) return direct;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Bot runtime unavailable: ${message}`);
  }
}

function payloadData(payload: any) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
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
    return { attempted: false, reason: 'persona-or-audio-missing' };
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
  return workerResponse.ok
    ? { attempted: true, ok: true }
    : { attempted: true, ok: false, status: workerResponse.status, error: text(result?.error, 500) };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as BotCommandBody | null;
    const command = text(body?.command || body?.message || body?.transcript, 5000);
    if (!command) {
      return NextResponse.json({ error: 'command is required' }, { status: 400 });
    }

    let accessToken = text(request.cookies.get(HMO_SPMT_COOKIE)?.value, 10000);
    if (!accessToken) {
      return NextResponse.json({ error: 'Sign in with SPMT to use your StreamWeaver bot' }, { status: 401 });
    }

    let upstream = await forwardBotCommand(accessToken, { ...body, command });
    let refreshed: Awaited<ReturnType<typeof refreshHmoSpmtSession>> = null;

    if (upstream.response.status === 401) {
      const refreshToken = text(request.cookies.get(HMO_SPMT_REFRESH_COOKIE)?.value, 10000);
      refreshed = refreshToken ? await refreshHmoSpmtSession(refreshToken) : null;
      if (refreshed) {
        accessToken = refreshed.accessToken;
        upstream = await forwardBotCommand(accessToken, { ...body, command });
      }
    }

    let personaSpeech: any = undefined;
    if (upstream.response.ok) {
      try {
        personaSpeech = await speakThroughPersona(body || {}, upstream.payload);
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
      ? { ...upstream.payload, personaSpeech, botRuntimeSource: upstream.source }
      : { ...upstream.payload, botRuntimeSource: upstream.source };
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Bot Commands] Runtime request failed:', message);
    return NextResponse.json({ error: message || 'Bot runtime unavailable' }, {
      status: 502,
      headers: { 'cache-control': 'private, no-store' },
    });
  }
}
