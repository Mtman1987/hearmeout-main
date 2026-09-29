import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const workers = {
  lounge: (process.env.LOUNGE_WORKER_URL || 'http://lounge.process.hmo-dj-worker.internal:3002').replace(/\/$/, ''),
  spotlight: (process.env.SPOTLIGHT_WORKER_URL || 'http://spotlight.process.hmo-dj-worker.internal:3002').replace(/\/$/, ''),
};

function allowed(parts: string[]) {
  if (parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part))) return false;
  const path = parts.join('/');
  return /^(?:lounge\/(?:media\/program|direct\/status|hls\.js|direct\/hls\/(?:index\.m3u8|segment_\d{6}\.ts)|music\/hls\/(?:[A-Za-z0-9_-]+\/)?(?:index\.m3u8|seg_\d+\.ts))|spotlight\/(?:program|hls\.js|hls\/[A-Za-z0-9_-]+\/(?:index\.m3u8|seg_\d{6}\.ts)))$/.test(path);
}

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (!path || !allowed(path)) return new Response('Not found', { status: 404 });
  const role = path[0] as keyof typeof workers;
  try {
    const upstream = await fetch(workers[role] + '/' + path.join('/'), {
      headers: getDjWorkerRequestHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(45000),
    });
    const headers = new Headers();
    for (const name of ['content-type', 'cache-control']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return Response.json({ error: 'Media worker unavailable' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
