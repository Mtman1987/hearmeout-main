import { NextRequest, NextResponse } from 'next/server';

declare global {
  // eslint-disable-next-line no-var
  var __peerVoiceRegistry: Map<string, Map<string, number>> | undefined;
}

const registry = globalThis.__peerVoiceRegistry || new Map<string, Map<string, number>>();
globalThis.__peerVoiceRegistry = registry;

const PEER_TTL = 15_000;

export async function GET(request: NextRequest) {
  const roomId = request.nextUrl.searchParams.get('roomId');
  if (!roomId) return NextResponse.json({ error: 'Missing roomId' }, { status: 400 });

  const room = registry.get(roomId);
  if (!room) return NextResponse.json({ peers: [] });

  const now = Date.now();
  const peers: string[] = [];
  for (const [peerId, ts] of room) {
    if (now - ts <= PEER_TTL) peers.push(peerId);
    else room.delete(peerId);
  }

  return NextResponse.json({ peers });
}
