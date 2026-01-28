import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/firebase/admin';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error)}`, req.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/login?error=no_authorization_code', req.url)
    );
  }

  try {
    const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/discord/callback`;

    // Exchange code for token
    const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId!,
        client_secret: clientSecret!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      throw new Error(`Discord token exchange failed: ${JSON.stringify(errorData)}`);
    }

    const { access_token } = await tokenResponse.json();

    // Get user info
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userResponse.ok) {
      throw new Error('Failed to fetch Discord user info');
    }

    const discordUser = await userResponse.json();
    const uid = `discord_${discordUser.id}`;

    // Create or update Firebase user
    try {
      await adminAuth.getUser(uid);
    } catch {
      await adminAuth.createUser({
        uid,
        email: discordUser.email,
        displayName: discordUser.username,
        photoURL: discordUser.avatar 
          ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
          : undefined,
      });
    }

    // Update Firestore
    await adminDb.collection('users').doc(uid).set({
      id: uid,
      username: discordUser.username,
      email: discordUser.email,
      displayName: discordUser.username,
      profileImageUrl: discordUser.avatar 
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : null,
      discordId: discordUser.id,
    }, { merge: true });

    // Create custom token
    const customToken = await adminAuth.createCustomToken(uid);

    // Redirect with token
    return NextResponse.redirect(
      new URL(`/login?token=${customToken}`, req.url)
    );
  } catch (error) {
    console.error('Discord OAuth error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(errorMessage)}`, req.url)
    );
  }
}
