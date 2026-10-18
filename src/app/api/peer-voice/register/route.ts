import { requireRoomVoiceAccess } from '@/lib/room-voice-access';
import { db, ensureDb } from '@/lib/db';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';
import { NextRequest, NextResponse } from 'next/server';

// In-memory peer registry (per-process, resets on deploy — fine for signaling)
declare global {
  // eslint-disable-next-line no-var
  var __peerVoiceRegistry: Map<string, Map<string, number>> | undefined;
}

const registry = globalThis.__peerVoiceRegistry || new Map<string, Map<string, number>>();
globalThis.__peerVoiceRegistry = registry;

const PEER_TTL = 15_000; // 15s — peers must re-register via polling

function cleanRoom(roomId: string) {
  const room = registry.get(roomId);
  if (!room) return;
  const now = Date.now();
  for (const [peerId, ts] of room) {
    if (now - ts > PEER_TTL) room.delete(peerId);
  }
  if (room.size === 0) registry.delete(roomId);
}

// POST — register/heartbeat a peer
export async function POST(request: NextRequest) {
  const { roomId, peerId } = await request.json();
  if (!roomId || !peerId) return NextResponse.json({ error: 'Missing roomId or peerId' }, { status: 400 });

  // Browser users are bound to the room session/password gate. The bridge worker
  // is separately authenticated and must be able to register its PeerJS audio
  // source when LiveKit quota is unavailable, including in stream-enabled rooms.
  const hasAuthorization = request.headers.has('authorization');
  const fromDjWorker = hasAuthorization && isDjWorkerRequest(request);
  if (fromDjWorker) {
    await ensureDb();
    if (!db.get('rooms', roomId)) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  } else {
    try { await requireRoomVoiceAccess(roomId); } catch { return NextResponse.json({ error: 'Room access required' }, { status: 403 }); }
    if (String(peerId).startsWith('hmo-zdiscord-')) {
      return NextResponse.json({ error: 'That PeerJS identity is reserved for the voice bridge' }, { status: 403 });
    }
  }

  if (!registry.has(roomId)) registry.set(roomId, new Map());
  registry.get(roomId)!.set(peerId, Date.now());
  cleanRoom(roomId);

  return NextResponse.json({ ok: true });
}

// DELETE — unregister a peer
export async function DELETE(request: NextRequest) {
  const { roomId, peerId } = await request.json();
  if (!roomId || !peerId) return NextResponse.json({ error: 'Missing roomId or peerId' }, { status: 400 });

  const fromDjWorker = request.headers.has('authorization') && isDjWorkerRequest(request);
  if (fromDjWorker) {
    await ensureDb();
    if (!db.get('rooms', roomId)) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  } else {
    try { await requireRoomVoiceAccess(roomId); } catch { return NextResponse.json({ error: 'Room access required' }, { status: 403 }); }
    if (String(peerId).startsWith('hmo-zdiscord-')) {
      return NextResponse.json({ error: 'Only the authenticated worker can unregister the voice bridge' }, { status: 403 });
    }
  }

  registry.get(roomId)?.delete(peerId);
  cleanRoom(roomId);

  return NextResponse.json({ ok: true });
}

