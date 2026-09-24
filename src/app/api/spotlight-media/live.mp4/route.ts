import { spotlightWorker } from '@/lib/spotlight-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const upstream = await spotlightWorker('live.mp4', 'GET', request.signal);
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: 'Spotlight source unavailable' }, { status: upstream.status });
    }
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
