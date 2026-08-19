import { NextRequest, NextResponse } from 'next/server';
import { searchWatchProviderOptions } from '@/lib/watch-request-service';

export async function GET(request: NextRequest) {
  const query = String(request.nextUrl.searchParams.get('q') || '').trim().slice(0, 160);
  if (query.length < 2) return NextResponse.json({ query, results: [], error: 'Enter at least two characters' }, { status: 400 });
  const startedAt = Date.now();
  const results = await searchWatchProviderOptions(query);
  return NextResponse.json({
    query,
    results,
    count: results.length,
    tookMs: Date.now() - startedAt,
    selectionRequired: results.length > 1,
  }, {
    headers: { 'cache-control': 'private, max-age=15, stale-while-revalidate=45' },
  });
}
