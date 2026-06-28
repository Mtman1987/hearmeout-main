import { NextRequest, NextResponse } from 'next/server';
import { getPublicWatchSession, requestWatchItem, requestWatchMusicItem, requestWatchTtsItem } from '@/lib/watch-request-service';
import { getGlobalMusicWatchSession, requestMusicItem } from '@/lib/music-session-service';
import { MUSIC_WATCH_SESSION_ID } from '@/lib/watch-session';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function getRequestBaseUrl(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const proto = forwardedProto || url.protocol.replace(':', '');
  const host = forwardedHost || request.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

function isMusicRequest(value: unknown) {
  return ['music', 'song', 'audio'].includes(String(value || '').trim().toLowerCase());
}

function isTtsRequest(value: unknown) {
  return ['tts', 'speech', 'bot-speech'].includes(String(value || '').trim().toLowerCase());
}

function watchRequestErrorPayload(result: unknown) {
  const payload = result as { error?: unknown; recommendation?: unknown; discovery?: unknown; result?: unknown };
  return {
    error: payload.error,
    recommendation: payload.recommendation || null,
    discovery: payload.discovery || null,
    result: payload.result || null,
  };
}

async function requestGlobalMusicWithWatchFallback(params: {
  query?: string | null;
  username?: string | null;
  platform?: 'discord' | 'twitch' | 'admin' | 'activity' | 'web';
  userId?: string | null;
  guildId?: string | null;
  channelId?: string | null;
}) {
  const roomResult = await requestMusicItem({
    query: params.query || '',
    username: params.username || 'local tester',
    platform: params.platform || 'web',
  });
  if (roomResult.result.success) {
    return {
      result: roomResult.result,
      session: await getGlobalMusicWatchSession(),
    };
  }

  const watchResult = await requestWatchMusicItem({
    sessionId: MUSIC_WATCH_SESSION_ID,
    guildId: params.guildId || undefined,
    channelId: params.channelId || undefined,
    query: params.query || undefined,
    userId: params.userId || 'local',
    username: params.username || 'local tester',
    platform: params.platform || 'web',
  });
  if ('error' in watchResult) {
    return { result: roomResult.result, error: watchResult.error };
  }
  return {
    result: watchResult.result,
    session: getPublicWatchSession(watchResult.session),
  };
}

export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const body = await request.json();
  const requestKind = body.mediaType || body.type || body.kind;
  if (sessionId === MUSIC_WATCH_SESSION_ID && isMusicRequest(requestKind)) {
    const result = await requestGlobalMusicWithWatchFallback({
      query: body.query,
      username: body.username || 'local tester',
      platform: body.platform || 'web',
      userId: body.userId || 'local',
      guildId: body.guildId,
      channelId: body.channelId,
    });
    if (!result.result.success || result.error) {
      return NextResponse.json({ error: 'No matching music item', result: result.result }, { status: 404, headers: CORS_HEADERS });
    }
    return NextResponse.json({
      result: result.result,
      session: result.session,
    }, {
      headers: CORS_HEADERS,
    });
  }

  const result = isTtsRequest(requestKind) ? await requestWatchTtsItem({
    sessionId,
    guildId: body.guildId,
    channelId: body.channelId,
    audioUrl: body.audioUrl || body.ttsUrl || body.url,
    text: body.text,
    title: body.title,
    botName: body.botName || body.username || 'Athena',
    userId: body.userId || 'bot',
    username: body.username || body.botName || 'Athena',
  }) : isMusicRequest(requestKind) ? await requestWatchMusicItem({
    sessionId,
    guildId: body.guildId,
    channelId: body.channelId,
    query: body.query,
    userId: body.userId || 'local',
    username: body.username || 'local tester',
    platform: body.platform || 'web',
  }) : await requestWatchItem({
    sessionId,
    guildId: body.guildId,
    channelId: body.channelId,
    query: body.query,
    itemId: body.itemId,
    userId: body.userId || 'local',
    username: body.username || 'local tester',
  });

  if ('error' in result) {
    return NextResponse.json(watchRequestErrorPayload(result), { status: 404, headers: CORS_HEADERS });
  }

  return NextResponse.json({
    request: result.request,
    session: getPublicWatchSession(result.session, getRequestBaseUrl(request)),
  }, {
    headers: CORS_HEADERS,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const requestKind = request.nextUrl.searchParams.get('mediaType') || request.nextUrl.searchParams.get('type') || request.nextUrl.searchParams.get('kind');
  if (sessionId === MUSIC_WATCH_SESSION_ID && isMusicRequest(requestKind)) {
    const result = await requestGlobalMusicWithWatchFallback({
      query: request.nextUrl.searchParams.get('query') || request.nextUrl.searchParams.get('q') || '',
      username: request.nextUrl.searchParams.get('username') || 'local tester',
      platform: 'web',
      userId: request.nextUrl.searchParams.get('userId') || 'local',
      guildId: request.nextUrl.searchParams.get('guildId'),
      channelId: request.nextUrl.searchParams.get('channelId'),
    });
    if (!result.result.success || result.error) {
      return NextResponse.json({ error: 'No matching music item', result: result.result }, { status: 404, headers: CORS_HEADERS });
    }
    return NextResponse.json({
      result: result.result,
      session: result.session,
    }, {
      headers: CORS_HEADERS,
    });
  }

  const result = isTtsRequest(requestKind) ? await requestWatchTtsItem({
    sessionId,
    guildId: request.nextUrl.searchParams.get('guildId') || undefined,
    channelId: request.nextUrl.searchParams.get('channelId') || undefined,
    audioUrl: request.nextUrl.searchParams.get('audioUrl') || request.nextUrl.searchParams.get('ttsUrl') || request.nextUrl.searchParams.get('url') || undefined,
    text: request.nextUrl.searchParams.get('text') || undefined,
    title: request.nextUrl.searchParams.get('title') || undefined,
    botName: request.nextUrl.searchParams.get('botName') || request.nextUrl.searchParams.get('username') || 'Athena',
    userId: request.nextUrl.searchParams.get('userId') || 'bot',
    username: request.nextUrl.searchParams.get('username') || request.nextUrl.searchParams.get('botName') || 'Athena',
  }) : isMusicRequest(requestKind) ? await requestWatchMusicItem({
    sessionId,
    guildId: request.nextUrl.searchParams.get('guildId') || undefined,
    channelId: request.nextUrl.searchParams.get('channelId') || undefined,
    query: request.nextUrl.searchParams.get('query') || request.nextUrl.searchParams.get('q') || undefined,
    userId: request.nextUrl.searchParams.get('userId') || 'local',
    username: request.nextUrl.searchParams.get('username') || 'local tester',
    platform: 'web',
  }) : await requestWatchItem({
    sessionId,
    guildId: request.nextUrl.searchParams.get('guildId') || undefined,
    channelId: request.nextUrl.searchParams.get('channelId') || undefined,
    query: request.nextUrl.searchParams.get('query') || request.nextUrl.searchParams.get('q') || undefined,
    itemId: request.nextUrl.searchParams.get('itemId') || undefined,
    userId: request.nextUrl.searchParams.get('userId') || 'local',
    username: request.nextUrl.searchParams.get('username') || 'local tester',
  });

  if ('error' in result) {
    return NextResponse.json(watchRequestErrorPayload(result), { status: 404, headers: CORS_HEADERS });
  }

  return NextResponse.json({
    request: result.request,
    session: getPublicWatchSession(result.session, getRequestBaseUrl(request)),
  }, {
    headers: CORS_HEADERS,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
