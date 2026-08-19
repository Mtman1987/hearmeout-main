import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, ensureDb } from '@/lib/db';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { ensureDiscordActivityRoom } from '@/lib/activity-room';
import { canManageRoom } from '@/lib/room-access';
import { isActivityRoomId } from '@/lib/watch-session';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';

// Room-scoped Discord <-> HearMeOut voice bridge control.
//
//   POST { roomId, action: 'start' | 'stop', guildId?, voiceChannelId? }
//     - Persists the selected guild/voice-channel on the room doc.
//     - Tells the DJ worker (which holds the gateway bot) to join/leave the VC.
//   POST { roomId, action: 'set-room-outbound', roomVoiceOutboundEnabled }
//     - Opens/closes only the HearMeOut room-microphone return path to Discord.
//     - Discord audio continues into HearMeOut while the gate is closed.
//   GET ?roomId=...
//     - Returns the persisted config plus the worker's live status.
//
// Owner/admin only. The heavy audio work lives in the worker; this route is a
// thin authenticated proxy so the browser never talks to the worker directly.

type VoiceBridgeConfig = {
  enabled: boolean;
  guildId: string;
  voiceChannelId: string;
  roomVoiceOutboundEnabled: boolean;
  audioProfile: 'low-latency' | 'balanced' | 'resilient';
  updatedBy?: string;
  updatedAt?: string;
};

function readConfig(room: any): VoiceBridgeConfig {
  const raw = room?.voiceBridge || {};
  return {
    enabled: Boolean(raw.enabled),
    guildId: String(raw.guildId || ''),
    voiceChannelId: String(raw.voiceChannelId || ''),
    // The bridge was historically two-way. Preserve an explicit listen-only
    // choice, but do not silently mute legacy rooms that predate this setting.
    roomVoiceOutboundEnabled:
      typeof raw.roomVoiceOutboundEnabled === 'boolean'
        ? raw.roomVoiceOutboundEnabled
        : true,
    audioProfile: ['low-latency', 'balanced', 'resilient'].includes(String(raw.audioProfile))
      ? raw.audioProfile
      : 'balanced',
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
      headers: getDjWorkerRequestHeaders({ 'Content-Type': 'application/json', ...(init?.headers || {}) }),
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
  const dbUser = db.get('users', uid) || {};
  const user = { ...dbUser, uid };
  const isOwner = room.ownerId === uid || room.createdBy === uid;
  const canManage = canManageRoom(user, room.ownerId) || (room.createdBy && canManageRoom(user, room.createdBy));
  const isAdmin = dbUser?.isAdmin === true;
  const isActivityRoom = isActivityRoomId(roomId);
  if (!isOwner && !canManage && !isAdmin && !isActivityRoom) return { ok: false as const, status: 403, error: 'Not authorized' };
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

  const { roomId, action, guildId, voiceChannelId, roomVoiceOutboundEnabled, audioProfile } = await req.json();
  if (!roomId || !action) return NextResponse.json({ error: 'Missing roomId or action' }, { status: 400 });
  if (isActivityRoomId(roomId)) await ensureDiscordActivityRoom();

  const auth = authorize(roomId, session.uid);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const current = readConfig(auth.room);
  const nextGuildId = String(guildId ?? current.guildId).trim();
  const nextChannelId = String(voiceChannelId ?? current.voiceChannelId).trim();

  if (action === 'start') {
    if (!nextGuildId || !nextChannelId) {
      return NextResponse.json({ error: 'Select a server and a voice channel first' }, { status: 400 });
    }
    const nextConfig: VoiceBridgeConfig = {
      enabled: true,
      guildId: nextGuildId,
      voiceChannelId: nextChannelId,
      roomVoiceOutboundEnabled: current.roomVoiceOutboundEnabled,
      audioProfile: current.audioProfile,
      updatedBy: session.uid,
      updatedAt: new Date().toISOString(),
    };
    db.set('rooms', roomId, { voiceBridge: nextConfig }, { merge: true });

    const result = await callWorker('/voice-bridge', {
      method: 'POST',
      body: JSON.stringify({
        action: 'start',
        roomId,
        guildId: nextGuildId,
        voiceChannelId: nextChannelId,
        audioProfile: current.audioProfile,
      }),
    });
    if (!result.ok) {
      db.set('rooms', roomId, { voiceBridge: { ...nextConfig, enabled: false } }, { merge: true });
      return NextResponse.json({ success: false, ...result.body }, { status: result.status });
    }

    // The worker starts listen-only by default. Apply the persisted room gate
    // only after the bridge is up. Legacy rooms resolve to two-way above;
    // explicit listen-only rooms remain private.
    const gateResult = await callWorker('/voice-bridge/gate', {
      method: 'POST',
      body: JSON.stringify({
        roomId,
        roomVoiceOutboundEnabled: current.roomVoiceOutboundEnabled,
      }),
    });
    if (!gateResult.ok || gateResult.body?.success === false) {
      await callWorker('/voice-bridge', {
        method: 'POST',
        body: JSON.stringify({ action: 'stop', roomId }),
      });
      db.set('rooms', roomId, { voiceBridge: { ...nextConfig, enabled: false } }, { merge: true });
      return NextResponse.json({
        success: false,
        error: gateResult.body?.error || gateResult.body?.message || 'Bridge privacy gate could not be confirmed',
      }, { status: gateResult.ok ? 502 : gateResult.status });
    }

    return NextResponse.json({
      success: true,
      ...result.body,
      status: gateResult.body?.status || result.body?.status,
      config: nextConfig,
    });
  }

  if (action === 'set-room-outbound') {
    if (typeof roomVoiceOutboundEnabled !== 'boolean') {
      return NextResponse.json({ error: 'roomVoiceOutboundEnabled must be boolean' }, { status: 400 });
    }

    const nextConfig: VoiceBridgeConfig = {
      ...current,
      roomVoiceOutboundEnabled,
      updatedBy: session.uid,
      updatedAt: new Date().toISOString(),
    };
    db.set('rooms', roomId, { voiceBridge: nextConfig }, { merge: true });

    if (!current.enabled) {
      return NextResponse.json({
        success: true,
        config: nextConfig,
        status: {
          running: false,
          roomVoiceOutboundEnabled,
          mode: roomVoiceOutboundEnabled ? 'two-way' : 'listen-only',
        },
      });
    }

    const result = await callWorker('/voice-bridge/gate', {
      method: 'POST',
      body: JSON.stringify({ roomId, roomVoiceOutboundEnabled }),
    });
    if (!result.ok || result.body?.success === false) {
      return NextResponse.json({
        success: false,
        error: result.body?.error || result.body?.message || 'Live bridge did not confirm privacy gate change',
        config: nextConfig,
      }, { status: result.ok ? 502 : result.status });
    }

    return NextResponse.json({ success: true, ...result.body, config: nextConfig });
  }

  if (action === 'set-audio-profile') {
    const normalizedProfile = String(audioProfile || '').trim().toLowerCase();
    if (!['low-latency', 'balanced', 'resilient'].includes(normalizedProfile)) {
      return NextResponse.json({ error: 'Invalid audio profile' }, { status: 400 });
    }
    const nextConfig: VoiceBridgeConfig = {
      ...current,
      audioProfile: normalizedProfile as VoiceBridgeConfig['audioProfile'],
      updatedBy: session.uid,
      updatedAt: new Date().toISOString(),
    };
    db.set('rooms', roomId, { voiceBridge: nextConfig }, { merge: true });
    const result = await callWorker('/voice-bridge/audio-profile', {
      method: 'POST',
      body: JSON.stringify({ roomId, audioProfile: normalizedProfile }),
    });
    return NextResponse.json({ success: result.ok, ...result.body, config: nextConfig }, { status: result.ok ? 200 : result.status });
  }

  if (action === 'stop') {
    const nextConfig: VoiceBridgeConfig = {
      ...current,
      enabled: false,
      updatedBy: session.uid,
      updatedAt: new Date().toISOString(),
    };
    db.set('rooms', roomId, { voiceBridge: nextConfig }, { merge: true });
    const result = await callWorker('/voice-bridge', {
      method: 'POST',
      body: JSON.stringify({ action: 'stop', roomId }),
    });
    return NextResponse.json({ success: result.ok, ...result.body, config: nextConfig }, { status: result.ok ? 200 : result.status });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
