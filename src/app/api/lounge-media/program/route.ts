const LOUNGE_PROGRAM_URL = (process.env.LOUNGE_PROGRAM_URL || 'https://hmo-dj-worker.fly.dev:4444/lounge/media/program').replace(/\/$/, '');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// This endpoint is a read-only public status snapshot on the Lounge worker.
// Do not require the shared worker secret just to render the current program;
// secret lookup was turning a missing/mismatched secret into a misleading 502.
export async function GET() {
  try {
    const upstream = await fetch(LOUNGE_PROGRAM_URL, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: { accept: 'application/json' },
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error('[Lounge media program] upstream request failed:', error);
    return Response.json({ error: 'Lounge worker unavailable' }, { status: 502 });
  }
}
