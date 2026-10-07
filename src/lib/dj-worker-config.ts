const PROD_DJ_WORKER_URL = 'https://hmo-dj-worker.fly.dev';
const DEV_DJ_WORKER_URL = 'http://localhost:3002';

export function getDjWorkerUrl(): string {
  const configured = process.env.DJ_WORKER_URL || process.env.NEXT_PUBLIC_DJ_WORKER_URL;
  if (configured) return configured.replace(/\/$/, '');
  return process.env.NODE_ENV === 'production' ? PROD_DJ_WORKER_URL : DEV_DJ_WORKER_URL;
}

export function isActivityMediaRequest(request: Request): boolean {
  return new URL(request.url).searchParams.get('lane') === 'activity';
}

export function getMediaWorkerUrl(request: Request): string {
  return isActivityMediaRequest(request)
    ? (process.env.ACTIVITY_WORKER_URL || 'https://hmo-dj-worker.fly.dev:4446').replace(/\/$/, '')
    : getDjWorkerUrl();
}

// Keep every child playlist and segment on the selected worker, including
// EXT-X-MEDIA audio playlists. Relative paths must remain relative.
export function activityMediaManifest(manifest: string): string {
  const tag = (value: string) => {
    const hashAt = value.indexOf('#');
    const hash = hashAt >= 0 ? value.slice(hashAt) : '';
    const raw = hashAt >= 0 ? value.slice(0, hashAt) : value;
    const [path, query = ''] = raw.split('?');
    const params = new URLSearchParams(query);
    params.set('lane', 'activity');
    return path + '?' + params.toString() + hash;
  };
  return manifest.split('\n').map(line => {
    if (line.trim() && !line.trim().startsWith('#')) return tag(line.trim());
    return line.replace(/URI="([^"]+)"/g, (_match, uri) => 'URI="' + tag(uri) + '"');
  }).join('\n');
}
