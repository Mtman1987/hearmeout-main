import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';

const LOUNGE_WORKER_URL = (process.env.LOUNGE_WORKER_URL || 'http://lounge.process.hmo-dj-worker.internal:3002').replace(/\/$/, '');

export async function loungeWorker(path: string, method = 'GET', signal?: AbortSignal) {
  return fetch(`${LOUNGE_WORKER_URL}/lounge/${path}`, {
    method,
    headers: getDjWorkerRequestHeaders(),
    cache: 'no-store',
    signal,
  });
}

export async function loungeMediaAction(body: Record<string, unknown>, signal: AbortSignal = AbortSignal.timeout(45000)) {
  const upstream = await fetch(`${LOUNGE_WORKER_URL}/lounge/media/actions`, {
    method: 'POST',
    headers: getDjWorkerRequestHeaders({ 'content-type': 'application/json', accept: 'application/json' }),
    body: JSON.stringify(body),
    cache: 'no-store',
    signal,
  });
  const payload = await upstream.json().catch(() => ({})) as Record<string, unknown>;
  if (!upstream.ok) {
    throw new Error(String(payload.error || `Lounge worker returned ${upstream.status}`));
  }
  return payload;
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
