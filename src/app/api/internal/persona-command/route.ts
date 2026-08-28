import { NextRequest, NextResponse } from 'next/server';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';
import { SPMT_BASE_URL, refreshHmoSpmtSession } from '@/lib/spmt-session';

const STREAMWEAVER_BASE_URL = String(
  process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev',
).replace(/\/$/, '');

type UpstreamResult = {
  response: Response;
  payload: any;
  source: 'streamweaver' | 'spmt';
};

function text(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max);
}

function upstreamBody(body: any) {
  return {
    command: text(body.command || body.transcript, 5000),
    source: 'hearmeout-persona',
    roomId: text(body.roomId, 160) || undefined,
    targetTenantId: text(body.targetTenantId, 128) || undefined,
    speak: true,
    voice: text(body.voice, 128) || undefined,
  };
}

async function postBotCommand(url: string, accessToken: string, body: any, source: UpstreamResult['source']): Promise<UpstreamResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(upstreamBody(body)),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(65000) : undefined,
  });
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || `Invalid ${source} response` }; }
  return { response, payload, source };
}

async function forward(accessToken: string, body: any): Promise<UpstreamResult> {
  let direct: UpstreamResult | null = null;
  try {
    direct = await postBotCommand(
      `${STREAMWEAVER_BASE_URL}/api/spmt/bot/commands`,
      accessToken,
      body,
      'streamweaver',
    );
  } catch (error) {
    console.warn('[Persona Command] Direct StreamWeaver request failed; trying SPMT bridge:', error);
  }

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

export async function POST(request: NextRequest) {
  if (!isDjWorkerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null) as any;
    const command = text(body?.command || body?.transcript, 5000);
    let accessToken = text(body?.accessToken, 10000);
    let refreshToken = text(body?.refreshToken, 10000);
    if (!command || !accessToken) {
      return NextResponse.json({ error: 'command and accessToken are required' }, { status: 400 });
    }

    let upstream = await forward(accessToken, { ...body, command });
    let refreshed: Awaited<ReturnType<typeof refreshHmoSpmtSession>> = null;
    if (upstream.response.status === 401 && refreshToken) {
      refreshed = await refreshHmoSpmtSession(refreshToken);
      if (refreshed) {
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken;
        upstream = await forward(accessToken, { ...body, command });
      }
    }

    return NextResponse.json({
      ...upstream.payload,
      botRuntimeSource: upstream.source,
      personaSession: {
        accessToken,
        refreshToken,
        refreshed: !!refreshed,
      },
    }, {
      status: upstream.response.status,
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Persona Command] Runtime request failed:', message);
    return NextResponse.json({ error: message || 'Bot runtime unavailable' }, {
      status: 502,
      headers: { 'cache-control': 'private, no-store' },
    });
  }
}
