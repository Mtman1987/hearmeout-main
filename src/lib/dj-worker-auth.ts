import { NextRequest } from 'next/server';

export function isDjWorkerRequest(req: NextRequest): boolean {
  return req.headers.get('x-hmo-dj-worker') === '1';
}
