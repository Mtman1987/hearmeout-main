import { NextRequest, NextResponse } from 'next/server';
import { auth as adminAuth, db as adminDb } from '@/firebase/admin';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/login?error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/login?error=no_authorization_code`
    );
  }

  try {
    const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/twitch/callback`;

    // Exchange code for token
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
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
      throw new Error(`Twitch token exchange failed: ${JSON.stringify(errorData)}`);
    }

    const tokens = await tokenResponse.json();

    // Get user info
    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': clientId!,
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    if (!userResponse.ok) {
      throw new Error('Failed to fetch Twitch user info');
    }

    const { data: users } = await userResponse.json();
    if (users.length === 0) {
      throw new Error('No user data returned from Twitch');
    }

    const twitchUser = users[0];

    // If this is bot authorization (state=twitch_bot), save bot credentials
    if (state === 'twitch_bot') {
      await adminDb.collection('config').doc('twitch_bot').set({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        username: twitchUser.login,
        updated_at: new Date().toISOString(),
      });
      
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_BASE_URL}/settings?bot_authorized=${twitchUser.login}`
      );
    }

    // Otherwise, this is user login
    const uid = `twitch_${twitchUser.id}`;

    // Create or update Firebase user
    try {
      await adminAuth.getUser(uid);
    } catch {
      await adminAuth.createUser({
        uid,
        email: twitchUser.email,
        displayName: twitchUser.display_name,
        photoURL: twitchUser.profile_image_url,
      });
    }

    // Update Firestore
    await adminDb.collection('users').doc(uid).set({
      id: uid,
      username: twitchUser.login,
      email: twitchUser.email,
      displayName: twitchUser.display_name,
      profileImageUrl: twitchUser.profile_image_url,
      twitchId: twitchUser.id,
    }, { merge: true });

    // Create custom token
    const customToken = await adminAuth.createCustomToken(uid);

    // Redirect with token
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/login?token=${customToken}`
    );
  } catch (error) {
    console.error('Twitch OAuth error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/login?error=${encodeURIComponent(errorMessage)}`
    );
  }
}
