import { requireRoomVoiceAccess } from '@/lib/room-voice-access';
import { db, ensureDb } from '@/lib/db';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';
import { validVoiceSource } from '@/lib/stream-voice-access';
import { NextRequest, NextResponse } from 'next/server';

declare global { var __peerVoiceRegistry: Map<string, Map<string, number>> | undefined; }
const registry = globalThis.__peerVoiceRegistry || new Map<string, Map<string, number>>();
globalThis.__peerVoiceRegistry = registry;
const PEER_TTL = 15_000;
function cleanRoom(roomId: string) {
  const room = registry.get(roomId); if (!room) return;
  const now = Date.now();
  for (const [peerId, ts] of room) if (now - ts > PEER_TTL) room.delete(peerId);
  if (room.size === 0) registry.delete(roomId);
}
async function authorize(request: NextRequest, roomId: string, peerId: string, sourceKey: string) {
  if (peerId.startsWith('hmo-stream-listener-') && validVoiceSource(roomId, sourceKey)) {
    await ensureDb();
    if (!db.get('rooms', roomId)?.streamVoiceEnabled) throw new Error('Voice broadcast is disabled');
    return;
  }
  const fromDjWorker = request.headers.has('authorization') && isDjWorkerRequest(request);
  if (fromDjWorker) {
    await ensureDb(); if (!db.get('rooms', roomId)) throw new Error('Room not found');
  } else {
    await requireRoomVoiceAccess(roomId);
    if (peerId.startsWith('hmo-zdiscord-')) throw new Error('Only the authenticated worker can unregister the voice bridge');
  }
}
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { roomId, peerId } = body;
  if (!roomId || !peerId) return NextResponse.json({ error: 'Missing roomId or peerId' }, { status: 400 });
  try { await authorize(request, roomId, String(peerId), String(body.sourceKey || '')); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Room access required' }, { status: 403 }); }
  if (!registry.has(roomId)) registry.set(roomId, new Map());
  registry.get(roomId)!.set(peerId, Date.now()); cleanRoom(roomId);
  return NextResponse.json({ ok: true });
}
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { roomId, peerId } = body;
  if (!roomId || !peerId) return NextResponse.json({ error: 'Missing roomId or peerId' }, { status: 400 });
  try { await authorize(request, roomId, String(peerId), String(body.sourceKey || '')); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Room access required' }, { status: 403 }); }
  registry.get(roomId)?.delete(peerId); cleanRoom(roomId);
  return NextResponse.json({ ok: true });
}
