import { NextResponse } from 'next/server';
import { parseJsonRequest } from '@/lib/request-json';
import { getPublicWatchSession, requestWatchItem, requestWatchMusicItem, requestWatchTtsItem } from '@/lib/watch-request-service';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function isMusicRequest(value: unknown) {
  return ['music', 'song', 'audio'].includes(String(value || '').trim().toLowerCase());
}

function isTtsRequest(value: unknown) {
  return ['tts', 'speech', 'bot-speech'].includes(String(value || '').trim().toLowerCase());
}

function watchRequestErrorPayload(result: unknown) {
  const payload = result as { error?: unknown; recommendation?: unknown; result?: unknown };
  return {
    error: payload.error,
    recommendation: payload.recommendation || null,
    result: payload.result || null,
  };
}

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    const body = await parseJsonRequest<any>(request);
    const requestKind = body.mediaType || body.type || body.kind;
    const result = isTtsRequest(requestKind) ? await requestWatchTtsItem({
      sessionId,
      audioUrl: body.audioUrl || body.ttsUrl || body.url,
      text: body.text,
      title: body.title,
      botName: body.botName || body.username || 'Athena',
      userId: body.userId || 'bot',
      username: body.username || body.botName || 'Athena',
    }) : isMusicRequest(requestKind) ? await requestWatchMusicItem({
      sessionId,
      query: body.query,
      userId: body.userId || 'activity',
      username: body.username || 'activity user',
      platform: 'activity',
    }) : await requestWatchItem({
      sessionId,
      query: body.query,
      itemId: body.itemId,
      userId: body.userId || 'activity',
      username: body.username || 'activity user',
    });

    if ('error' in result) {
      return NextResponse.json(
        watchRequestErrorPayload(result),
        { status: 404, headers: CORS_HEADERS },
      );
    }

    return NextResponse.json({
      request: result.request,
      session: getPublicWatchSession(result.session),
    }, { headers: CORS_HEADERS });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Invalid request' }, { status: 400, headers: CORS_HEADERS });
  }
}

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const url = new URL(request.url);
  const requestKind = url.searchParams.get('mediaType') || url.searchParams.get('type') || url.searchParams.get('kind');
  const result = isTtsRequest(requestKind) ? await requestWatchTtsItem({
    sessionId,
    audioUrl: url.searchParams.get('audioUrl') || url.searchParams.get('ttsUrl') || url.searchParams.get('url') || undefined,
    text: url.searchParams.get('text') || undefined,
    title: url.searchParams.get('title') || undefined,
    botName: url.searchParams.get('botName') || url.searchParams.get('username') || 'Athena',
    userId: url.searchParams.get('userId') || 'bot',
    username: url.searchParams.get('username') || url.searchParams.get('botName') || 'Athena',
  }) : isMusicRequest(requestKind) ? await requestWatchMusicItem({
    sessionId,
    query: url.searchParams.get('query') || url.searchParams.get('q') || undefined,
    userId: url.searchParams.get('userId') || 'activity',
    username: url.searchParams.get('username') || 'activity user',
    platform: 'activity',
  }) : await requestWatchItem({
    sessionId,
    query: url.searchParams.get('query') || url.searchParams.get('q') || undefined,
    itemId: url.searchParams.get('itemId') || undefined,
    userId: url.searchParams.get('userId') || 'activity',
    username: url.searchParams.get('username') || 'activity user',
  });

  if ('error' in result) {
    return NextResponse.json(
      watchRequestErrorPayload(result),
      { status: 404, headers: CORS_HEADERS },
    );
  }

  return NextResponse.json({
    request: result.request,
    session: getPublicWatchSession(result.session),
  }, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
