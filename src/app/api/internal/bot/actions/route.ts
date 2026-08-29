import { NextRequest, NextResponse } from 'next/server';
import { isBotActionServiceRequest } from '@/lib/bot-action-service-auth';
import {
  controlWatchSession,
  getPublicWatchSession,
  getWatchSession,
  requestWatchMusicItem,
} from '@/lib/watch-request-service';
import { getMusicWatchSessionId, getRoomWatchSessionId } from '@/lib/watch-session';
import {
  changeRoomPersonaForBotAction,
  controlVoiceBridgeForBotAction,
  listRoomsForBotAction,
  readVoiceBridgeForBotAction,
} from '@/lib/bot-room-action-service';

export const dynamic = 'force-dynamic';

type HearMeOutAction =
  | 'hmo.media.state.read'
  | 'hmo.media.request'
  | 'hmo.media.control'
  | 'hmo.rooms.read'
  | 'hmo.bot.control'
  | 'hmo.voice.bridge.state'
  | 'hmo.voice.bridge.control';
const ACTIONS = new Set<HearMeOutAction>([
  'hmo.media.state.read',
  'hmo.media.request',
  'hmo.media.control',
  'hmo.rooms.read',
  'hmo.bot.control',
  'hmo.voice.bridge.state',
  'hmo.voice.bridge.control',
]);
const CONTROLS = new Set(['play', 'pause', 'next', 'clear', 'mute', 'unmute', 'volume']);

function text(value: unknown, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function publicBaseUrl(request: Request) {
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

export async function POST(request: NextRequest) {
  if (!isBotActionServiceRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as any;
  const action = text(body?.action, 80) as HearMeOutAction;
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'Unknown HearMeOut bot action' }, { status: 400 });
  const roomId = text(body?.roomId, 160);
  const room = roomId || text(body?.room, 160) || undefined;
  const sessionId = text(body?.sessionId, 160) || (roomId ? getRoomWatchSessionId(roomId, 'music') : getMusicWatchSessionId());

  try {
    const actor = {
      actorUserId: text(body?.actorUserId, 160),
      tenantId: text(body?.tenantId, 160),
      actorRole: text(body?.actorRole, 40),
    };

    if (action === 'hmo.rooms.read') {
      const rooms = await listRoomsForBotAction(actor);
      return NextResponse.json({ success: true, action, count: rooms.length, rooms });
    }

    if (action === 'hmo.bot.control') {
      const control = text(body?.control, 20).toLowerCase();
      if (control !== 'join' && control !== 'leave') {
        return NextResponse.json({ error: 'Bot control must be join or leave' }, { status: 400 });
      }
      const result = await changeRoomPersonaForBotAction({ ...actor, room, control, bot: body?.bot });
      return NextResponse.json({ action, ...result });
    }

    if (action === 'hmo.voice.bridge.state') {
      return NextResponse.json({ action, ...(await readVoiceBridgeForBotAction({ ...actor, room })) });
    }

    if (action === 'hmo.voice.bridge.control') {
      const control = text(body?.control, 40).toLowerCase() as any;
      if (!['start', 'stop', 'listen-only', 'two-way', 'profile'].includes(control)) {
        return NextResponse.json({ error: 'Unsupported voice bridge control' }, { status: 400 });
      }
      const result = await controlVoiceBridgeForBotAction({
        ...actor,
        room,
        control,
        guildId: text(body?.guildId, 80),
        voiceChannel: text(body?.voiceChannel, 120),
        audioProfile: text(body?.audioProfile, 40),
      });
      return NextResponse.json({ action, ...result });
    }

    if (action === 'hmo.media.state.read') {
      const session = getPublicWatchSession(getWatchSession(sessionId, undefined, undefined, 'music'), publicBaseUrl(request));
      return NextResponse.json({ success: true, action, session });
    }

    if (action === 'hmo.media.request') {
      const query = text(body?.query, 500);
      if (!query) return NextResponse.json({ error: 'A song, story, or audio request is required' }, { status: 400 });
      const result = await requestWatchMusicItem({
        sessionId,
        query,
        username: text(body?.actorName, 100) || 'StreamWeaver bot action',
        userId: text(body?.actorUserId, 160) || text(body?.tenantId, 160) || 'streamweaver',
        platform: 'admin',
      });
      if ('error' in result) {
        return NextResponse.json({ error: result.result?.message || result.error }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        action,
        message: result.result.message,
        request: result.request,
        session: getPublicWatchSession(result.session, publicBaseUrl(request)),
      });
    }

    const control = text(body?.control, 40).toLowerCase();
    if (!CONTROLS.has(control)) return NextResponse.json({ error: 'Unsupported media control' }, { status: 400 });
    const rawValue = body?.value;
    const value = rawValue === undefined || rawValue === null || rawValue === '' ? undefined : Number(rawValue);
    const session = await controlWatchSession(sessionId, control, Number.isFinite(value) ? value : undefined, undefined, {
      actorUserId: text(body?.actorUserId, 160),
      isAdmin: true,
      platform: 'admin',
    });
    return NextResponse.json({
      success: true,
      action,
      control,
      session: getPublicWatchSession(session, publicBaseUrl(request)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[HearMeOutBotAction] ${action} failed:`, error);
    const status = /not shared|banned|manage/i.test(message)
      ? 403
      : /not found|no manageable|no available/i.test(message)
        ? 404
        : /more than one/i.test(message)
          ? 409
          : /required|must be|unsupported|profile/i.test(message)
            ? 400
            : /unavailable|unreachable|worker|discord/i.test(message)
              ? 502
              : 500;
    return NextResponse.json({ error: message, action }, { status });
  }
}
