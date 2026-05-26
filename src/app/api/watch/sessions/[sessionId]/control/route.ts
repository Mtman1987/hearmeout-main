import { NextResponse } from 'next/server';
import { controlWatchSession, getPublicWatchSession } from '@/lib/watch-request-service';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    const body = await request.json();
    const rawPosition = body?.position;
    const parsedPosition = rawPosition === undefined || rawPosition === null || rawPosition === ''
      ? undefined
      : Number(rawPosition);
    const session = controlWatchSession(
      sessionId,
      String(body.action || '').toLowerCase(),
      Number.isFinite(parsedPosition as number) ? (parsedPosition as number) : undefined,
      Number(body.targetIndex),
    );
    return NextResponse.json(getPublicWatchSession(session), { headers: CORS_HEADERS });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unsupported action' }, { status: 400, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
