import { NextRequest, NextResponse } from 'next/server';
import { isBotActionServiceRequest } from '@/lib/bot-action-service-auth';
import {
  controlWatchSession,
  getPublicWatchSession,
  getWatchSession,
  requestWatchItem,
  requestWatchMusicItem,
} from '@/lib/watch-request-service';
import { ACTIVITY_ROOM_ID, getGlobalWatchSessionId, getMusicWatchSessionId, getRoomWatchSessionId } from '@/lib/watch-session';
import {
  changeRoomPersonaForBotAction,
  controlVoiceBridgeForBotAction,
  listRoomsForBotAction,
  readVoiceBridgeForBotAction,
} from '@/lib/bot-room-action-service';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';

export const dynamic = 'force-dynamic';

type HearMeOutAction =
  | 'hmo.media.state.read'
  | 'hmo.media.request'
  | 'hmo.media.control'
  | 'hmo.rooms.read'
  | 'hmo.bot.control'
  | 'hmo.voice.bridge.state'
  | 'hmo.voice.bridge.control'
  | 'hmo.tts.speak';
const ACTIONS = new Set<HearMeOutAction>([
  'hmo.media.state.read',
  'hmo.media.request',
  'hmo.media.control',
  'hmo.rooms.read',
  'hmo.bot.control',
  'hmo.voice.bridge.state',
  'hmo.voice.bridge.control',
  'hmo.tts.speak',
]);
const CONTROLS = new Set(['play', 'pause', 'next', 'clear', 'mute', 'unmute', 'volume']);
const APOLLO_LOUNGE_ROOM_ID = 'system-spacemountainlive-lounge';
// Keep the existing !sr destination as the one permanent mixed SpaceMountain player.
// Movies, music, state reads, and controls all use this exact durable session.
const SPACEMOUNTAIN_LOUNGE_SESSION_ID = getRoomWatchSessionId(APOLLO_LOUNGE_ROOM_ID, 'music');

function isSpaceMountainLoungeSession(tenantId: string, sessionId: string) {
  return tenantId === 'spacemountainlive'
    && (sessionId === getMusicWatchSessionId() || sessionId === getGlobalWatchSessionId());
}

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
  const body = await request.json().catch(() => null) as any;
  const action = text(body?.action, 80) as HearMeOutAction;
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'Unknown HearMeOut bot action' }, { status: 400 });
  const roomId = text(body?.roomId, 160);
  const room = roomId || text(body?.room, 160) || undefined;
  const sessionId = text(body?.sessionId, 160) || (roomId ? getRoomWatchSessionId(roomId, 'music') : getMusicWatchSessionId());
  const actorRole = text(body?.actorRole, 40).toLowerCase();
  const tenantId = text(body?.tenantId, 160).toLowerCase();
  const isGlobalSession = sessionId === getMusicWatchSessionId() || sessionId === getGlobalWatchSessionId();
  const isPublicQueueRequest = !room && (
    action === 'hmo.media.request' || action === 'hmo.media.state.read'
  ) && isGlobalSession;
  const isSpaceMountainLoungeControl = !room
    && action === 'hmo.media.control'
    && isGlobalSession
    && tenantId === 'spacemountainlive'
    && (actorRole === 'owner' || actorRole === 'moderator');
  if (!isPublicQueueRequest && !isSpaceMountainLoungeControl && !isBotActionServiceRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const actor = {
      actorUserId: text(body?.actorUserId, 160),
      tenantId,
      actorRole,
    };

    if (action === 'hmo.tts.speak') {
      const targetRoomId = room || ACTIVITY_ROOM_ID;
      const audioDataUri = String(body?.audioDataUri || '').trim();
      if (!audioDataUri.startsWith('data:audio')) {
        return NextResponse.json({ error: 'A TTS audio data URI is required' }, { status: 400 });
      }
      if (audioDataUri.length > 30_000_000) {
        return NextResponse.json({ error: 'TTS audio payload is too large' }, { status: 413 });
      }
      const workerResponse = await fetch(`${getDjWorkerUrl()}/room-tts/speak`, {
        method: 'POST',
        headers: getDjWorkerRequestHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
        body: JSON.stringify({ roomId: targetRoomId, audioDataUri }),
        cache: 'no-store',
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(45_000) : undefined,
      });
      const workerPayload = await workerResponse.json().catch(() => ({})) as any;
      if (!workerResponse.ok || workerPayload?.success === false) {
        throw new Error(String(workerPayload?.error || `Room TTS worker returned ${workerResponse.status}`));
      }
      return NextResponse.json({ success: true, action, roomId: targetRoomId, ...workerPayload });
    }

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
      if (isSpaceMountainLoungeSession(tenantId, sessionId)) {
        const session = getPublicWatchSession(getWatchSession(SPACEMOUNTAIN_LOUNGE_SESSION_ID, undefined, undefined, 'music'), publicBaseUrl(request));
        return NextResponse.json({ success: true, action, session });
      }
      const mediaKind = sessionId === getGlobalWatchSessionId() ? 'movie' : 'music';
      const session = getPublicWatchSession(getWatchSession(sessionId, undefined, undefined, mediaKind), publicBaseUrl(request));
      return NextResponse.json({ success: true, action, session });
    }

    if (action === 'hmo.media.request') {
      const query = text(body?.query, 500);
      if (!query) return NextResponse.json({ error: 'A song, story, or audio request is required' }, { status: 400 });
      if (isSpaceMountainLoungeSession(tenantId, sessionId)) {
        const kind = sessionId === getGlobalWatchSessionId() ? 'movie' : 'music';
        const requestIdentity = {
          sessionId: SPACEMOUNTAIN_LOUNGE_SESSION_ID,
          query,
          username: text(body?.actorName, 100) || 'SpaceMountainLive',
          userId: text(body?.actorUserId, 160) || 'spacemountainlive',
        };
        const result = kind === 'movie'
          ? await requestWatchItem(requestIdentity)
          : await requestWatchMusicItem({ ...requestIdentity, platform: 'twitch' });
        if ('error' in result) {
          const failed = result as { error: string; result?: { message?: string } };
          return NextResponse.json({ error: failed.result?.message || failed.error }, { status: 404 });
        }
        return NextResponse.json({
          success: true,
          action,
          message: ('result' in result ? result.result?.message : '') || 'Added to the SpaceMountain lounge queue.',
          request: result.request,
          session: getPublicWatchSession(result.session, publicBaseUrl(request)),
        });
      }
      const requestIdentity = {
        sessionId,
        query,
        username: text(body?.actorName, 100) || 'StreamWeaver bot action',
        userId: text(body?.actorUserId, 160) || text(body?.tenantId, 160) || 'streamweaver',
      };
      const result = sessionId === getGlobalWatchSessionId()
        ? await requestWatchItem(requestIdentity)
        : await requestWatchMusicItem({ ...requestIdentity, platform: 'admin' });
      if ('error' in result) {
        const failed = result as { error: string; result?: { message?: string } };
        return NextResponse.json({ error: failed.result?.message || failed.error }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        action,
        message: ('result' in result ? result.result?.message : '') || 'Request added to queue',
        request: result.request,
        session: getPublicWatchSession(result.session, publicBaseUrl(request)),
      });
    }

    const control = text(body?.control, 40).toLowerCase();
    if (!CONTROLS.has(control)) return NextResponse.json({ error: 'Unsupported media control' }, { status: 400 });
    const rawValue = body?.value;
    const value = rawValue === undefined || rawValue === null || rawValue === '' ? undefined : Number(rawValue);
    const controlSessionId = isSpaceMountainLoungeSession(tenantId, sessionId) ? SPACEMOUNTAIN_LOUNGE_SESSION_ID : sessionId;
    const session = await controlWatchSession(controlSessionId, control, Number.isFinite(value) ? value : undefined, undefined, {
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
          : /required|must be|unsupported|profile|payload/i.test(message)
            ? 400
            : /unavailable|unreachable|worker|discord|tts/i.test(message)
              ? 502
              : 500;
    return NextResponse.json({ error: message, action }, { status });
  }
}
