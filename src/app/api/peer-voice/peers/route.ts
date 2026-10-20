import { requireRoomVoiceAccess } from '@/lib/room-voice-access';
import { db, ensureDb } from '@/lib/db';
import { validVoiceSource } from '@/lib/stream-voice-access';
import { NextRequest, NextResponse } from 'next/server';

declare global { var __peerVoiceRegistry: Map<string, Map<string, number>> | undefined; }
const registry = globalThis.__peerVoiceRegistry || new Map<string, Map<string, number>>();
globalThis.__peerVoiceRegistry = registry;
const PEER_TTL = 15_000;

export async function GET(request: NextRequest) {
  const roomId = request.nextUrl.searchParams.get('roomId') || '';
  const sourceKey = request.nextUrl.searchParams.get('sourceKey') || '';
  if (!roomId) return NextResponse.json({ error: 'Missing roomId' }, { status: 400 });
  if (validVoiceSource(roomId, sourceKey)) {
    await ensureDb();
    if (!db.get('rooms', roomId)?.streamVoiceEnabled) return NextResponse.json({ error: 'Voice broadcast is disabled' }, { status: 403 });
  } else {
    try { await requireRoomVoiceAccess(roomId); } catch { return NextResponse.json({ error: 'Room access required' }, { status: 403 }); }
  }
  const room = registry.get(roomId);
  if (!room) return NextResponse.json({ peers: [] });
  const now = Date.now(), peers: string[] = [];
  for (const [peerId, ts] of room) { if (now - ts <= PEER_TTL) peers.push(peerId); else room.delete(peerId); }
  return NextResponse.json({ peers });
}
