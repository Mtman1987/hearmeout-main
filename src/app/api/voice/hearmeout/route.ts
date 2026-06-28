import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { getOverlayWatchSessionId } from '@/lib/watch-session';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

type OpenRoom = {
  index: number;
  id: string;
  name: string;
  description: string;
  activeCount: number;
  roomUrl: string;
  overlayUrl: string;
};

type PendingChoice = {
  rooms: OpenRoom[];
  expiresAt: number;
};

const pendingChoices = new Map<string, PendingChoice>();

function getRequestBaseUrl(request: Request) {
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function normalizeKey(userId: unknown, username: unknown) {
  return normalizeText(userId || username || 'anonymous').toLowerCase();
}

function isHearMeOutTriggered(text: string) {
  return /\bhear\s*me\s*out\b/i.test(text) || /\bhearmeout\b/i.test(text);
}

function stripTrigger(text: string) {
  return text.replace(/\bhear\s*me\s*out\b/ig, '').replace(/\bhearmeout\b/ig, '').trim();
}

function getChoiceNumber(text: string) {
  const normalized = text.toLowerCase();
  const match = normalized.match(/\b(?:join\s*)?(?:room\s*)?([1-9]\d*)\b/);
  return match ? Number(match[1]) : null;
}

function wantsNewRoom(text: string) {
  return /\b(new|create|make|start|open)\b/i.test(text) && /\b(room|one)\b/i.test(text);
}

function wantsRoomList(text: string) {
  return /\b(rooms?|open|available|list|who'?s in|what'?s open)\b/i.test(text);
}

function wantsJoin(text: string) {
  return /\b(join|enter|go to|put me in|take me to)\b/i.test(text);
}

function roomPayload(room: OpenRoom) {
  return {
    roomId: room.id,
    roomName: room.name,
    roomUrl: room.roomUrl,
    overlayUrl: room.overlayUrl,
    watchMovieSessionId: getOverlayWatchSessionId(room.id, 'movie'),
    watchMusicSessionId: getOverlayWatchSessionId(room.id, 'music'),
  };
}

function listOpenRooms(baseUrl: string): OpenRoom[] {
  const now = Date.now();
  const rooms = db.list('rooms')
    .filter((room) => room.data?.isPrivate !== true)
    .filter((room) => {
      const expiresAt = room.data?.expiresAt ? Date.parse(room.data.expiresAt) : 0;
      return !expiresAt || expiresAt > now;
    })
    .map((room) => {
      const users = db.list(`rooms/${room.id}/users`);
      const activeCount = users.filter((u) => {
        const lastSeen = Number(u.data?.lastSeen || 0);
        return lastSeen > 0 && now - lastSeen < 45000;
      }).length;
      return {
        id: room.id,
        name: room.data?.name || room.id,
        description: room.data?.description || '',
        activeCount,
        createdAt: Date.parse(room.data?.createdAt || '') || 0,
      };
    })
    .sort((a, b) => b.activeCount - a.activeCount || b.createdAt - a.createdAt)
    .slice(0, 8);

  return rooms.map((room, index) => ({
    index: index + 1,
    id: room.id,
    name: room.name,
    description: room.description,
    activeCount: room.activeCount,
    roomUrl: `${baseUrl}/rooms/${room.id}`,
    overlayUrl: `${baseUrl}/overlay/${room.id}`,
  }));
}

function roomsSpeakText(rooms: OpenRoom[]) {
  if (rooms.length === 0) return 'I do not see any open HearMeOut rooms.';
  const roomList = rooms.map((room) => `Room ${room.index}: ${room.name}${room.activeCount ? ` with ${room.activeCount} online` : ''}`).join('. ');
  return `${roomList}. Say a room number to join.`;
}

function findRoomByName(rooms: OpenRoom[], text: string) {
  const normalized = text.toLowerCase();
  return rooms.find((room) => normalized.includes(room.name.toLowerCase()));
}

export async function GET(request: NextRequest) {
  await ensureDb();
  const baseUrl = getRequestBaseUrl(request);
  const rooms = listOpenRooms(baseUrl);
  return NextResponse.json({
    handled: true,
    action: 'list_rooms',
    speakText: roomsSpeakText(rooms),
    rooms,
  }, { headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  await ensureDb();
  const baseUrl = getRequestBaseUrl(request);
  const body = await request.json().catch(() => ({}));
  const rawText = normalizeText(body.message || body.text || body.transcript || body.command);
  const username = normalizeText(body.username || body.displayName || 'Guest');
  const key = normalizeKey(body.userId, username);
  const pending = pendingChoices.get(key);
  const hasPending = !!pending && pending.expiresAt > Date.now();
  const triggered = isHearMeOutTriggered(rawText);
  const text = triggered ? stripTrigger(rawText) : rawText;

  if (!triggered && !hasPending) {
    return NextResponse.json({
      handled: false,
      speakText: '',
      reason: 'No HearMeOut trigger phrase or pending room choice.',
    }, { headers: CORS_HEADERS });
  }

  if (hasPending) {
    if (wantsNewRoom(text)) {
      pendingChoices.delete(key);
      return NextResponse.json({
        handled: true,
        action: 'cannot_create_room',
        speakText: 'I cannot create rooms by voice. Create a named room in HearMeOut first.',
      }, { headers: CORS_HEADERS });
    }

    const choice = getChoiceNumber(text);
    if (choice) {
      const room = pending.rooms.find((candidate) => candidate.index === choice);
      if (room) {
        pendingChoices.delete(key);
        return NextResponse.json({
          handled: true,
          action: 'join_room',
          speakText: `Joining ${room.name}.`,
          ...roomPayload(room),
        }, { headers: CORS_HEADERS });
      }
    }
  }

  const rooms = listOpenRooms(baseUrl);
  const namedRoom = findRoomByName(rooms, text);
  if (namedRoom && wantsJoin(text)) {
    pendingChoices.delete(key);
    return NextResponse.json({
      handled: true,
      action: 'join_room',
      speakText: `Joining ${namedRoom.name}.`,
      ...roomPayload(namedRoom),
    }, { headers: CORS_HEADERS });
  }

  if (wantsNewRoom(text) || /\bcreate\b/i.test(text)) {
    pendingChoices.delete(key);
    return NextResponse.json({
      handled: true,
      action: 'cannot_create_room',
      speakText: 'I cannot create rooms by voice. Create a named room in HearMeOut first.',
    }, { headers: CORS_HEADERS });
  }

  if (wantsJoin(text) || wantsRoomList(text) || !text) {
    pendingChoices.set(key, { rooms, expiresAt: Date.now() + 2 * 60 * 1000 });
    return NextResponse.json({
      handled: true,
      action: rooms.length > 0 ? 'choose_room' : 'no_rooms',
      speakText: roomsSpeakText(rooms),
      rooms,
      pending: rooms.length > 0 ? 'room_choice' : undefined,
    }, { headers: CORS_HEADERS });
  }

  pendingChoices.set(key, { rooms, expiresAt: Date.now() + 2 * 60 * 1000 });
  return NextResponse.json({
    handled: true,
    action: 'choose_room',
    speakText: roomsSpeakText(rooms),
    rooms,
    pending: 'room_choice',
  }, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
