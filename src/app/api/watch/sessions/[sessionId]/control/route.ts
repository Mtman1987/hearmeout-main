import { isTwitchMusicSession } from '@/lib/twitch-media-scope';
import { isBotActionServiceRequest } from '@/lib/bot-action-service-auth';
import { NextResponse } from 'next/server';
import { parseJsonRequest } from '@/lib/request-json';
import { controlWatchSession, getPublicWatchSession } from '@/lib/watch-request-service';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
  if (isTwitchMusicSession(sessionId) && !isBotActionServiceRequest(request)) return NextResponse.json({ error: 'Use this stream’s Twitch chat to request music' }, { status: 403 });
    const body = await parseJsonRequest<any>(request);
    const rawPosition = body?.position;
    const parsedPosition = rawPosition === undefined || rawPosition === null || rawPosition === ''
      ? undefined
      : Number(rawPosition);
    const session = await controlWatchSession(
      sessionId,
      String(body.action || '').toLowerCase(),
      Number.isFinite(parsedPosition as number) ? (parsedPosition as number) : undefined,
      Number(body.targetIndex),
      {
        actorUserId: body.actorUserId || body.userId,
        roomId: body.roomId,
        guildId: body.guildId,
        channelId: body.channelId,
        isHost: Boolean(body.isHost),
        isAdmin: Boolean(body.isAdmin),
        platform: body.platform || (body.guildId && body.channelId ? 'discord' : body.roomId ? 'room' : 'web'),
        expectedRequestId: body.expectedRequestId || undefined,
      },
    );
    return NextResponse.json(getPublicWatchSession(session), { headers: CORS_HEADERS });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unsupported action' }, { status: 400, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
