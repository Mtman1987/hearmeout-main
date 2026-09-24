import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';

const SPOTLIGHT_WORKER_URL = (process.env.SPOTLIGHT_WORKER_URL || 'http://hmo-spotlight-worker.internal:3002').replace(/\/$/, '');

export async function spotlightWorker(path: string, method = 'GET', signal?: AbortSignal) {
  return fetch(`${SPOTLIGHT_WORKER_URL}/spotlight/${path}`, {
    method, headers: getDjWorkerRequestHeaders(), cache: 'no-store', signal,
  });
}

export async function spotlightAction(action: 'start' | 'consent') {
  try {
    const upstream = await spotlightWorker(action, 'POST', AbortSignal.timeout(30000));
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
