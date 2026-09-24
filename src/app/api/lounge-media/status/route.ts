import { loungeWorker } from '@/lib/lounge-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const upstream = await loungeWorker('status', 'GET', AbortSignal.timeout(10000));
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
