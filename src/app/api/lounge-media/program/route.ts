import { loungeWorker } from '@/lib/lounge-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The persistent Lounge worker owns the current music/movie queue and clock.
// Saved web watch sessions are separate and must not redirect this viewer.
export async function GET() {
  try {
    const upstream = await loungeWorker('media/program', 'GET', AbortSignal.timeout(8000));
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json({ error: 'Lounge worker unavailable' }, { status: 502 });
  }
}
