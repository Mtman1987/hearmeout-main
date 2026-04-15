import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { setSessionCookie } from '@/lib/auth';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://hearmeout-main.fly.dev';
const DSH_URL = 'https://discord-stream-hub-new.fly.dev';

export async function GET(req: NextRequest) {
  await ensureDb();
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Handle DSH redirect back with Twitch user info
  const success = searchParams.get('success');
  const userId = searchParams.get('user_id');
  const username = searchParams.get('username');
  if (success === 'true' && userId && username) {
    const uid = `twitch_${userId}`;
    const displayName = searchParams.get('display_name') || username;
    const photoURL = searchParams.get('photo_url') || null;
    db.set('users', uid, {
      id: uid, username, displayName, photoURL,
      twitchId: userId,
    }, { merge: true });
    await setSessionCookie(uid);
    return NextResponse.redirect(`${BASE_URL}/login?success=true`);
  }

  if (error) {
    return NextResponse.redirect(`${BASE_URL}/login?error=${encodeURIComponent(error)}`);
  }

  // Bot authorization — handle locally (HMO has the bot credentials)
  if (code && state === 'twitch_bot') {
    try {
      const clientId = process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
      const clientSecret = process.env.TWITCH_CLIENT_SECRET;
      if (!clientId || !clientSecret) throw new Error('Twitch OAuth not configured for bot auth');

      const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId, client_secret: clientSecret, code,
          grant_type: 'authorization_code',
          redirect_uri: `${BASE_URL}/api/auth/twitch/callback`,
        }),
      });
      if (!tokenResponse.ok) throw new Error('Token exchange failed');
      const tokens = await tokenResponse.json();

      const userRes = await fetch('https://api.twitch.tv/helix/users', {
        headers: { 'Client-ID': clientId, Authorization: `Bearer ${tokens.access_token}` },
      });
      const { data: users } = await userRes.json();
      const twitchUser = users[0];

      db.set('config', 'twitch_bot', {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        username: twitchUser.login,
        updated_at: new Date().toISOString(),
      });

      return NextResponse.redirect(`${BASE_URL}/settings?bot_authorized=${twitchUser.login}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.redirect(`${BASE_URL}/login?error=${encodeURIComponent(msg)}`);
    }
  }

  // User login — redirect to DSH Twitch OAuth (DSH has the client secret)
  if (!code) {
    const clientId = process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || 'rxmohc28tthq0nudfd6iwx0sgy88dp';
    const dshCallback = `${DSH_URL}/api/twitch/oauth/callback`;
    const twitchUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(dshCallback)}&response_type=code&scope=user:read:email&state=hearmeout`;
    return NextResponse.redirect(twitchUrl);
  }

  // Fallback — code present but no state, try local exchange
  return NextResponse.redirect(`${BASE_URL}/login?error=invalid_twitch_callback`);
}
