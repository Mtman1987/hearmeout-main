import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';
import { getLoungeSourceState } from '@/lib/lounge-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const [source, upstream] = await Promise.all([
    getLoungeSourceState(),
    fetch(`${getDjWorkerUrl()}/lounge-media/status`, { headers: getDjWorkerRequestHeaders(), cache: 'no-store', signal: AbortSignal.timeout(10000) }).then(r => r.json()).catch(() => ({ ready: false })),
  ]);
  return Response.json({ lane: source.lane, current: source.session.current?.item.title || null, queueLength: source.session.queue.length, source: upstream }, { headers: { 'cache-control': 'no-store' } });
}
