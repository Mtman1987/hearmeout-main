const PROD_DJ_WORKER_URL = 'https://hmo-dj-worker.fly.dev';
const DEV_DJ_WORKER_URL = 'http://localhost:3002';

export function getDjWorkerUrl(): string {
  const configured = process.env.DJ_WORKER_URL || process.env.NEXT_PUBLIC_DJ_WORKER_URL;
  if (configured) return configured.replace(/\/$/, '');
  return process.env.NODE_ENV === 'production' ? PROD_DJ_WORKER_URL : DEV_DJ_WORKER_URL;
}

export function getDjWorkerSecret(): string {
  return process.env.DJ_WORKER_SECRET || '';
}
