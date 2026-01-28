import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
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
        scope: 'identify email',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Discord token exchange failed: ${tokenResponse.statusText}`);
    }

    const { access_token, refresh_token, expires_in } = await tokenResponse.json();

    // Get user info
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userResponse.ok) {
      throw new Error('Failed to fetch Discord user info');
    }

    const user = await userResponse.json();

    // Create redirect response
    const response = NextResponse.redirect(new URL('/rooms', req.url));

    // Store tokens in secure httpOnly cookies
    response.cookies.set('discord_access_token', access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: expires_in,
    });

    if (refresh_token) {
      response.cookies.set('discord_refresh_token', refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });
    }

    response.cookies.set('discord_user', JSON.stringify(user), {
      httpOnly: false, // Can be read by client-side code
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
    });

    return response;
  } catch (error) {
    console.error('Discord OAuth error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(errorMessage)}`, req.url)
    );
  }
}
