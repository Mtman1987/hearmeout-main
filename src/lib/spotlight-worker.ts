import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';

export async function spotlightWorker(path: string, method = 'GET', signal?: AbortSignal) {
  return fetch(`${getDjWorkerUrl()}/spotlight/${path}`, {
    method, headers: getDjWorkerRequestHeaders(), cache: 'no-store', signal,
  });
}

export async function spotlightAction(request: Request, action: 'start' | 'consent') {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  }
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
