import { NextRequest, NextResponse } from 'next/server';
import { recordLegacyRouteUse } from '@/lib/route-telemetry';

// Deprecated: use /api/dj instead. This just forwards for backwards compat.
export async function POST(req: NextRequest) {
  recordLegacyRouteUse('/api/dj-debug', req);
  const body = await req.json().catch(() => ({}));
  const baseUrl = new URL(req.url).origin;
  const res = await fetch(`${baseUrl}/api/dj`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ success: false }));
  return NextResponse.json(data, { status: res.status });
}
