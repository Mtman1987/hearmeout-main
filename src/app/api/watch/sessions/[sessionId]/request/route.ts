import { NextRequest, NextResponse } from 'next/server';
import { announceWatchRequestToDiscord, getPublicWatchSession, requestWatchItem, requestWatchMusicItem, requestWatchTtsItem } from '@/lib/watch-request-service';

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
    success: false,
    error: payload.error,
    recommendation: payload.recommendation || null,
    discovery: payload.discovery || null,
    result: payload.result || null,
  };
}

function isActivityPlatform(value: unknown) {
  return String(value || '').trim().toLowerCase() === 'activity';
}

function softMissStatus(payload: ReturnType<typeof watchRequestErrorPayload>, platform: unknown) {
  return isActivityPlatform(platform) && (payload.recommendation || payload.discovery || payload.result) ? 200 : 404;
}

export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const body = await request.json();
  const requestKind = body.mediaType || body.type || body.kind;
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
    const payload = watchRequestErrorPayload(result);
    return NextResponse.json(payload, { status: softMissStatus(payload, body.platform), headers: CORS_HEADERS });
  }

  const discordAnnouncement = body.announceDiscord
    ? await announceWatchRequestToDiscord({
        request: result.request,
        session: result.session,
        publicBaseUrl: getRequestBaseUrl(request),
        activityVoiceChannelId: body.activityVoiceChannelId || body.voiceChannelId || body.voice_channel_id,
      }).catch((error) => ({ ok: false, error: error?.message || 'Discord announcement failed' }))
    : null;

  return NextResponse.json({
    request: result.request,
    session: getPublicWatchSession(result.session, getRequestBaseUrl(request)),
    discordAnnouncement,
  }, {
    headers: CORS_HEADERS,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const requestKind = request.nextUrl.searchParams.get('mediaType') || request.nextUrl.searchParams.get('type') || request.nextUrl.searchParams.get('kind');
  const platform = request.nextUrl.searchParams.get('platform') || undefined;
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
    platform: (platform as any) || 'web',
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
    const payload = watchRequestErrorPayload(result);
    return NextResponse.json(payload, { status: softMissStatus(payload, platform), headers: CORS_HEADERS });
  }

  const discordAnnouncement = ['1', 'true', 'yes'].includes(String(request.nextUrl.searchParams.get('announceDiscord') || '').toLowerCase())
    ? await announceWatchRequestToDiscord({
        request: result.request,
        session: result.session,
        publicBaseUrl: getRequestBaseUrl(request),
        activityVoiceChannelId: request.nextUrl.searchParams.get('activityVoiceChannelId') || request.nextUrl.searchParams.get('voiceChannelId') || request.nextUrl.searchParams.get('voice_channel_id') || undefined,
      }).catch((error) => ({ ok: false, error: error?.message || 'Discord announcement failed' }))
    : null;

  return NextResponse.json({
    request: result.request,
    session: getPublicWatchSession(result.session, getRequestBaseUrl(request)),
    discordAnnouncement,
  }, {
    headers: CORS_HEADERS,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
