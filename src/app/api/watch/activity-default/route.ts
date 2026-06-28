import { NextResponse } from 'next/server';
import { getDefaultActivitySessionId } from '@/lib/watch/watch-request-service';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawSessionId = url.searchParams.get('sessionId') || url.searchParams.get('session_id');
  return NextResponse.json({
    sessionId: getDefaultActivitySessionId(rawSessionId),
  }, {
    headers: {
      'cache-control': 'no-store',
    },
  });
}
