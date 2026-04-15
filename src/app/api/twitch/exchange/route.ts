import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';

export async function POST(req: NextRequest) {
  const { code } = await req.json();

  if (!code) {
    return NextResponse.json({ error: 'Missing code' }, { status: 400 });
  }

  await ensureDb();

  const clientId = process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Twitch OAuth not configured' }, { status: 500 });
  }

  try {
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/twitch/exchange`,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Twitch token exchange failed:', err);
      return NextResponse.json({ error: 'Token exchange failed' }, { status: 400 });
    }

    const tokens = await tokenRes.json();

    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Client-Id': clientId,
      },
    });

    const userData = await userRes.json();
    const username = userData.data[0].login;

    db.set('config', 'twitch_bot', {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      username,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, username });
  } catch (error) {
    console.error('Token exchange error:', error);
    return NextResponse.json({ error: 'Failed to exchange token' }, { status: 500 });
  }
}
