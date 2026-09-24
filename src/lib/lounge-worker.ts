import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';

export async function loungeWorker(path: string, method = 'GET', signal?: AbortSignal) {
  return fetch(`${getDjWorkerUrl()}/lounge/${path}`, {
    method,
    headers: getDjWorkerRequestHeaders(),
    cache: 'no-store',
    signal,
  });
}

export async function loungeAction(action: 'start') {
  try {
    const upstream = await loungeWorker(action, 'POST', AbortSignal.timeout(30000));
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
