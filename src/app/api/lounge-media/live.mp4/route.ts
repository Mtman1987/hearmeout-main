import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const upstream = await fetch(`${getDjWorkerUrl()}/lounge-media/live.mp4`, {
      headers: getDjWorkerRequestHeaders(), cache: 'no-store', signal: request.signal,
    });
    if (!upstream.ok || !upstream.body) return Response.json({ error: 'Lounge source starting' }, { status: upstream.status });
    return new Response(upstream.body, {
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store, no-transform',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
