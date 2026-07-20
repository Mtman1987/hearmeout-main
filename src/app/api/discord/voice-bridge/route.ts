import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, ensureDb } from '@/lib/db';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';

// Room-scoped Discord <-> HearMeOut voice bridge control.
//
//   POST { roomId, action: 'start' | 'stop', guildId?, voiceChannelId? }
//     - Persists the selected guild/voice-channel on the room doc.
//     - Tells the DJ worker (which holds the gateway bot) to join/leave the VC.
//   GET ?roomId=...
//     - Returns the persisted config plus the worker's live status.
//
// Owner/admin only. The heavy audio work lives in the worker; this route is a
// thin authenticated proxy so the browser never talks to the worker directly.

type VoiceBridgeConfig = {
  enabled: boolean;
  guildId: string;
  voiceChannelId: string;
  updatedBy?: string;
  updatedAt?: string;
};

function readConfig(room: any): VoiceBridgeConfig {
  const raw = room?.voiceBridge || {};
  return {
    enabled: Boolean(raw.enabled),
    guildId: String(raw.guildId || ''),
    voiceChannelId: String(raw.voiceChannelId || ''),
    updatedBy: raw.updatedBy,
    updatedAt: raw.updatedAt,
  };
}

async function callWorker(path: string, init?: RequestInit) {
  const url = getDjWorkerUrl();
  if (!url) return { ok: false, status: 503, body: { error: 'Worker not configured' } };
  try {
    const res = await fetch(`${url}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'x-hmo-dj-worker': '1', ...(init?.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (error: any) {
    return { ok: false, status: 502, body: { error: `Worker unreachable: ${error?.message || error}` } };
  }
}

function authorize(roomId: string, uid: string) {
  const room = db.get('rooms', roomId);
  if (!room) return { ok: false as const, status: 404, error: 'Room not found' };
  const isOwner = room.ownerId === uid || room.createdBy === uid;
  const isAdmin = db.get('users', uid)?.isAdmin === true;
  if (!isOwner && !isAdmin) return { ok: false as const, status: 403, error: 'Not authorized' };
  return { ok: true as const, room };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureDb();

  const roomId = new URL(req.url).searchParams.get('roomId') || '';
  if (!roomId) return NextResponse.json({ error: 'Missing roomId' }, { status: 400 });

  const room = db.get('rooms', roomId);
  const cfg = readConfig(room);
  const status = await callWorker(`/voice-bridge?roomId=${encodeURIComponent(roomId)}`, { method: 'GET' });

  return NextResponse.json({ config: cfg, worker: status.body });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureDb();

  const { roomId, action, guildId, voiceChannelId } = await req.json();
  if (!roomId || !action) return NextResponse.json({ error: 'Missing roomId or action' }, { status: 400 });

  const auth = authorize(roomId, session.uid);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const current = readConfig(auth.room);
  const nextGuildId = String(guildId ?? current.guildId).trim();
  const nextChannelId = String(voiceChannelId ?? current.voiceChannelId).trim();

  if (action === 'start') {
    if (!nextGuildId || !nextChannelId) {
      return NextResponse.json({ error: 'Select a server and a voice channel first' }, { status: 400 });
    }
    db.set('rooms', roomId, {
      voiceBridge: {
        enabled: true,
        guildId: nextGuildId,
        voiceChannelId: nextChannelId,
        updatedBy: session.uid,
        updatedAt: new Date().toISOString(),
      } satisfies VoiceBridgeConfig,
    }, { merge: true });

    const result = await callWorker('/voice-bridge', {
      method: 'POST',
      body: JSON.stringify({ action: 'start', roomId, guildId: nextGuildId, voiceChannelId: nextChannelId }),
    });
    if (!result.ok) {
      db.set('rooms', roomId, { voiceBridge: { ...readConfig(db.get('rooms', roomId)), enabled: false } }, { merge: true });
    }
    return NextResponse.json({ success: result.ok, ...result.body }, { status: result.ok ? 200 : result.status });
  }

  if (action === 'stop') {
    db.set('rooms', roomId, {
      voiceBridge: { ...current, enabled: false, updatedBy: session.uid, updatedAt: new Date().toISOString() },
    }, { merge: true });
    const result = await callWorker('/voice-bridge', {
      method: 'POST',
      body: JSON.stringify({ action: 'stop', roomId }),
    });
    return NextResponse.json({ success: result.ok, ...result.body }, { status: result.ok ? 200 : result.status });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
