import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  return new NextResponse(null, {
    status: 307,
    headers: { location: `/activity${requestUrl.search}`, 'cache-control': 'no-store' },
  });
}
