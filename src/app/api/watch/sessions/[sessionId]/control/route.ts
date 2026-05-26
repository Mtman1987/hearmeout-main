import { NextResponse } from 'next/server';
import { controlWatchSession, getPublicWatchSession } from '@/lib/watch-request-service';

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    const body = await request.json();
    const rawPosition = body?.position;
    const parsedPosition = rawPosition === undefined || rawPosition === null || rawPosition === ""
      ? undefined
      : Number(rawPosition);
    const session = controlWatchSession(
      sessionId,
      String(body.action || "").toLowerCase(),
      Number.isFinite(parsedPosition as number) ? (parsedPosition as number) : undefined
    );
    return NextResponse.json(getPublicWatchSession(session));
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unsupported action' }, { status: 400 });
  }
}
