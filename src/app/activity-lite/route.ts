import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  const requestUrl = new URL(request.url);
  const targetUrl = new URL(`${baseUrl}/activity`);
  targetUrl.search = requestUrl.search;
  return NextResponse.redirect(targetUrl.toString(), 308);
}
