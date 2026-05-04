import { NextRequest } from 'next/server';
import { getDjWorkerSecret } from '@/lib/dj-worker-config';

export function isDjWorkerRequest(req: NextRequest): boolean {
  const secret = getDjWorkerSecret();
  if (!secret || secret === 'change-me-in-production') return false;

  const header =
    req.headers.get('x-dj-worker-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();

  return header === secret;
}
