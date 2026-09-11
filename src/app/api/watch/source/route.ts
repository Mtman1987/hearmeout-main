import { NextResponse } from 'next/server';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';
import { resolveSharedSource } from '@/lib/watch/shared-source';
export async function GET(request: Request) {
  if (!isDjWorkerRequest(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const requestId = url.searchParams.get('requestId');
  if ((kind !== 'movie' && kind !== 'music') || !requestId) return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
  const source = await resolveSharedSource(kind, requestId, url.origin);
  return source ? NextResponse.json(source, { headers: { 'cache-control': 'no-store' } }) : NextResponse.json({ error: 'Source changed' }, { status: 409 });
}
