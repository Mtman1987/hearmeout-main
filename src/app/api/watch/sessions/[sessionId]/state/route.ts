import { NextResponse } from 'next/server';
import { getPublicWatchSession, getResolvedWatchSession } from '@/lib/watch-request-service';
const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type' };
export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (new URL(request.url).searchParams.has('mediaFile')) {
    return NextResponse.json({ error: 'Reopen the shared player.' }, { status: 410, headers: CORS_HEADERS });
  }
  return NextResponse.json(getPublicWatchSession(getResolvedWatchSession(sessionId), new URL(request.url).origin), {
    headers: { ...CORS_HEADERS, 'cache-control': 'no-store' },
  });
}
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS_HEADERS }); }
