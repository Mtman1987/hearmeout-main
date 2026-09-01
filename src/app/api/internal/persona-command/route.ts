import { NextRequest, NextResponse } from 'next/server';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';
import { db, ensureDb } from '@/lib/db';

const STREAMWEAVER_BASE_URL = String(
  process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev',
).replace(/\/$/, '');

function text(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max);
}

async function forwardService(body: any) {
  const actor = await resolveServiceActor(text(body.actorIdentity, 160));
  const response = await fetch(`${STREAMWEAVER_BASE_URL}/api/internal/hearmeout/persona-command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      command: text(body.command || body.transcript, 5000),
      roomId: text(body.roomId, 160) || undefined,
      targetTenantId: text(body.targetTenantId, 128) || undefined,
      voice: text(body.voice, 128) || undefined,
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

async function resolveServiceActor(identity: string) {
  if (!identity) {
    return {
      actorUserId: '',
      actorUsername: 'HearMeOut room',
      actorDisplayName: 'HearMeOut room',
    };
  }
  await ensureDb();
  const user = db.get('users', identity) || {};
  return {
    actorUserId: text(user.discordId || user.twitchId || user.spmtUserId || identity, 160),
    actorUsername: text(user.username || user.twitchUsername || user.displayName || identity, 100),
    actorDisplayName: text(user.displayName || user.username || user.twitchUsername || identity, 100),
  };
}

export async function POST(request: NextRequest) {
  if (!isDjWorkerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as any;
  const command = text(body?.command || body?.transcript, 5000);
  if (!command) {
    return NextResponse.json({ error: 'command is required' }, { status: 400 });
  }

  // GLOBAL INVARIANT: this is a human conversation delivered by the trusted
  // HearMeOut worker. It must never require, refresh, or inspect a user's SPMT
  // session, Bot Share, or a StreamWeaver bearer secret.
  const upstream = await forwardService({ ...body, command });
  return NextResponse.json(upstream.payload, {
    status: upstream.response.status,
    headers: { 'cache-control': 'private, no-store' },
  });
}
