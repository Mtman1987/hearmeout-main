import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  return NextResponse.redirect(`${baseUrl}/activity`, 308);
}
