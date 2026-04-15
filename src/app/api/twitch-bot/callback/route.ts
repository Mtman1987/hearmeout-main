import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  
  if (error || !code) {
    const redirectUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://hearmeout-main.fly.dev'}/dashboard?error=${encodeURIComponent(error || 'OAuth failed')}`;
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${redirectUrl}"></head><body>Redirecting...</body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  }

  await ensureDb();

  try {
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,
        client_secret: process.env.TWITCH_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://hearmeout-main.fly.dev'}/api/twitch-bot/callback`,
      }),
    });

    const tokens = await tokenResponse.json();
    if (!tokens.access_token) throw new Error('No access token');

    // Get bot username
    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,
        'Authorization': `Bearer ${tokens.access_token}`,
      },
    });
    const userData = await userResponse.json();
    const username = userData.data[0]?.login;

    // Save to DB
    db.set('config', 'twitch_bot', {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      username: username || 'unknown',
      updated_at: new Date().toISOString(),
    });

const redirectUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://hearmeout-main.fly.dev'}/?success=twitch_bot_linked`;
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${redirectUrl}"></head><body>Redirecting...</body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  } catch (e) {
    const redirectUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://hearmeout-main.fly.dev'}/dashboard?error=${encodeURIComponent(e instanceof Error ? e.message : 'Unknown error')}`;
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${redirectUrl}"></head><body>Redirecting...</body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  }
}

