import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const SOURCE = 'https://discord-stream-hub-new.fly.dev/api/community-spotlight';
export async function GET() {
  try {
    const response = await fetch(SOURCE, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    const login = [data?.login, data?.channel, data?.twitchLogin, data?.spotlight?.twitchLogin, data?.spotlight?.login, data?.data?.login].find((value) => typeof value === 'string' && value.trim());
    if (!response.ok || !login) return NextResponse.json({ error: 'No live community Spotlight is available' }, { status: 503 });
    return NextResponse.json({ login: login.trim().replace(/^@/, '').toLowerCase() }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ error: 'No live community Spotlight is available' }, { status: 503 });
  }
}
