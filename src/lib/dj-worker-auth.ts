import { timingSafeEqual } from 'node:crypto';

const LOCAL_DEV_SECRET = 'hearmeout-local-worker-development-only';

function getWorkerSecret(): string {
  const configured = process.env.HMO_WORKER_SHARED_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== 'production') return LOCAL_DEV_SECRET;
  throw new Error('HMO_WORKER_SHARED_SECRET is required in production');
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

  try {
    return secretsMatch(authorization.slice(7), getWorkerSecret());
  } catch (error) {
    console.error('[DJ Worker Auth] Refusing callback because worker authentication is not configured:', error);
    return false;
  }
}
