import { NextResponse } from 'next/server';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';
import { getXtreamStreamUrl, type XtreamKind } from '@/lib/watch/xtream-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ kind: string; streamId: string }> }) {
  if (!isDjWorkerRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { kind, streamId } = await context.params;
  if (kind !== 'vod' && kind !== 'live' && kind !== 'series' && kind !== 'episode') {
    return NextResponse.json({ error: 'Unsupported Xtream stream kind' }, { status: 400 });
  }

  const url = await getXtreamStreamUrl(kind as XtreamKind, streamId);
  return NextResponse.json({ url: url.toString() });
}
