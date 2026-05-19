import { NextResponse } from 'next/server';
import { listWatchCatalog } from '@/lib/watch-request-service';

export async function GET() {
  return NextResponse.json({ items: listWatchCatalog() });
}
