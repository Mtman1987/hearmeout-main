import { NextResponse } from 'next/server';
import { controlWatchSession, getPublicWatchSession } from '@/lib/watch-request-service';

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const body = await request.json();
  try {
    const session = controlWatchSession(sessionId, String(body.action || '').toLowerCase(), Number(body.position || 0));
    return NextResponse.json(getPublicWatchSession(session));
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unsupported action' }, { status: 400 });
  }
}
