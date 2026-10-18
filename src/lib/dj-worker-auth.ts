import { timingSafeEqual } from 'node:crypto';

// Temporary compatibility fallback: keep the app and worker on the same
// marker when the optional deployment secret has not been configured.
// Replace with a managed secret after the bridge is confirmed working.
const LOCAL_DEV_SECRET = 'hearmeout-local-worker-development-only';

function getWorkerSecret(): string {
  const configured = process.env.HMO_WORKER_SHARED_SECRET?.trim();
  return configured || LOCAL_DEV_SECRET;
}

function secretsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function getDjWorkerRequestHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set('Authorization', `Bearer ${getWorkerSecret()}`);
  return result;
}

export function isDjWorkerRequest(req: Request): boolean {
  const authorization = req.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return false;

  return secretsMatch(authorization.slice(7), getWorkerSecret());
}
