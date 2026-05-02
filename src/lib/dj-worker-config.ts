const DEFAULT_DJ_WORKER_URL = 'https://hmo-dj-worker.fly.dev';
const DEFAULT_DJ_WORKER_SECRET = 'change-me-in-production';

export function getDjWorkerUrl(): string {
  return (process.env.DJ_WORKER_URL || process.env.NEXT_PUBLIC_DJ_WORKER_URL || DEFAULT_DJ_WORKER_URL).replace(/\/$/, '');
}

export function getDjWorkerSecret(): string {
  return process.env.DJ_WORKER_SECRET || DEFAULT_DJ_WORKER_SECRET;
}
