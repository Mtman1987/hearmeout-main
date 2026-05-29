import { NextResponse } from 'next/server';
import { parseJsonRequest } from '@/lib/request-json';
import { getPublicWatchSession, requestWatchItem } from '@/lib/watch-request-service';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    const body = await parseJsonRequest<any>(request);
    const result = await requestWatchItem({
      sessionId,
      query: body.query,
      itemId: body.itemId,
      userId: body.userId || 'activity',
      username: body.username || 'activity user',
    });

    if ('error' in result) {
      return NextResponse.json(
        { error: result.error, recommendation: result.recommendation || null },
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
  const result = await requestWatchItem({
    sessionId,
    query: url.searchParams.get('query') || url.searchParams.get('q') || undefined,
    itemId: url.searchParams.get('itemId') || undefined,
    userId: url.searchParams.get('userId') || 'activity',
    username: url.searchParams.get('username') || 'activity user',
  });

  if ('error' in result) {
    return NextResponse.json(
      { error: result.error, recommendation: result.recommendation || null },
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
