import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { code } = await req.json();

  if (!code) {
    return NextResponse.json({ error: 'Missing code' }, { status: 400 });
  }

  try {
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,
        client_secret: process.env.TWITCH_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/settings`,
      }),
    });

    const tokens = await tokenRes.json();

    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Client-Id': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,
      },
    });

    const userData = await userRes.json();
    const username = userData.data[0].login;

    // Save to Firestore
    const { db } = await import('@/firebase/admin');
    await db.collection('config').doc('twitch_bot').set({
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
