import { NextRequest, NextResponse } from 'next/server';
import { searchWatchProviders } from '@/lib/watch-request-service';

export async function GET(request: NextRequest) {
  return NextResponse.json({ results: await searchWatchProviders(request.nextUrl.searchParams.get('q')) });
}
