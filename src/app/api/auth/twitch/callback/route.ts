import { NextRequest, NextResponse } from 'next/server';

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
      throw new Error(`Twitch token exchange failed: ${tokenResponse.statusText}`);
    }

    const { access_token, refresh_token, expires_in } = await tokenResponse.json();

    // Get user info
    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': clientId!,
        Authorization: `Bearer ${access_token}`,
      },
    });

    if (!userResponse.ok) {
      throw new Error('Failed to fetch Twitch user info');
    }

    const { data: users } = await userResponse.json();
    if (users.length === 0) {
      throw new Error('No user data returned from Twitch');
    }

    const user = users[0];

    // Create redirect response
    const response = NextResponse.redirect(new URL('/rooms', req.url));

    // Store tokens in secure httpOnly cookies
    response.cookies.set('twitch_access_token', access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: expires_in,
    });

    if (refresh_token) {
      response.cookies.set('twitch_refresh_token', refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });
    }

    response.cookies.set('twitch_user', JSON.stringify(user), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
    });

    return response;
  } catch (error) {
    console.error('Twitch OAuth error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(errorMessage)}`, req.url)
    );
  }
}
