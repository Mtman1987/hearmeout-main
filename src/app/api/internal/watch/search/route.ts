import { NextRequest, NextResponse } from 'next/server';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';
import { GET as searchMovies } from '@/app/api/watch/search/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Apollo reuses the existing worker binding. Provider credentials and catalog
// selection stay in HearMeOut; no browser session is needed by this caller.
export async function GET(request: NextRequest) {
  if (!isDjWorkerRequest(request)) {
    return NextResponse.json({ error: 'Worker authentication required' }, { status: 401 });
  }
  const response = await searchMovies(request);
  response.headers.set('cache-control', 'no-store');
  return response;
}
