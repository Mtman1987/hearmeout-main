import { NextResponse } from 'next/server';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';
import { advanceSharedSource, getPublicWatchSession } from '@/lib/watch-request-service';
export async function POST(request: Request) {
  if (!isDjWorkerRequest(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { kind, requestId, failed } = await request.json();
  if ((kind !== 'music' && kind !== 'movie') || typeof requestId !== 'string' || !requestId) return NextResponse.json({ error: 'Invalid completion' }, { status: 400 });
  const session = await advanceSharedSource(kind, requestId, failed === true);
  return NextResponse.json(getPublicWatchSession(session));
}
