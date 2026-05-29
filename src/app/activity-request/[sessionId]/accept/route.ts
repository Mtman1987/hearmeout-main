import { NextResponse } from 'next/server';
import { parseJsonRequest } from '@/lib/request-json';
import { acceptWatchRecommendation, getPublicWatchSession } from '@/lib/watch-request-service';

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    const body = await parseJsonRequest<any>(request);
    const result = acceptWatchRecommendation({
      sessionId,
      userId: body.userId || 'activity',
      username: body.username || 'activity user',
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({
      request: result.request,
      session: getPublicWatchSession(result.session),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Invalid request' }, { status: 400 });
  }
}
