import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { setSessionCookie } from '@/lib/auth';
import { enrichUserFromDSH } from '@/lib/enrich-user';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://hearmeout-main.fly.dev';
const DSH_URL = 'https://discord-stream-hub-new.fly.dev';
const DB_API_KEY = process.env.DB_API_KEY || '';

export async function GET(req: NextRequest) {
  await ensureDb();
  const { searchParams } = new URL(req.url);

  // Check if DSH OAuth was successful
  const success = searchParams.get('success');
  const userId = searchParams.get('user_id');
  if (success === 'true' && userId) {
    try {
      // Fetch user's Discord tokens from shared user-specific tokens collection
      const headers: Record<string, string> = {};
      if (DB_API_KEY) headers['x-api-key'] = DB_API_KEY;
      const response = await fetch(`${DSH_URL}/api/db?path=tokens/user_${userId}_discord`, { headers });
      if (response.ok) {
        const tokenData = await response.json();
        if (tokenData.exists && tokenData.data) {
          const d = tokenData.data;
          const discordUserId = d.user_id || d.userId || userId;
          const username = d.username;
          const avatar = d.avatar;
          
          const uid = `discord_${discordUserId}`;
          const photoURL = avatar
            ? `https://cdn.discordapp.com/avatars/${discordUserId}/${avatar}.png`
            : null;
            
          await db.setAsync('users', uid, {
            id: uid,
            username,
            displayName: username,
            photoURL,
            discordId: discordUserId,
          });
          
          await setSessionCookie(uid);
          enrichUserFromDSH(discordUserId).catch(() => {});
          return NextResponse.redirect(`${BASE_URL}/`);
        }
      }
    } catch (error) {
      console.error('Failed to retrieve user Discord tokens:', error);
    }
  }

  // Legacy flow - DSH redirected here after doing the real OAuth + writing user to shared SQLite
  const legacyUserId = searchParams.get('user_id');
  const username = searchParams.get('username');

  if (legacyUserId && username) {
    const uid = `discord_${legacyUserId}`;

    // User already exists in shared SQLite (DSH wrote it) — just set HMO's session cookie
    const existing = await db.getAsync('users', uid);
    if (!existing) {
      const avatar = searchParams.get('avatar');
      const photoURL = avatar
        ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`
        : null;
      await db.setAsync('users', uid, {
        id: uid,
        username,
        displayName: username,
        photoURL,
        discordId: legacyUserId,
      });
    }

    await setSessionCookie(uid);
    enrichUserFromDSH(legacyUserId).catch(() => {});
    return NextResponse.redirect(`${BASE_URL}/`);
  }

  // No user info — redirect to DSH to do the OAuth
  const error = searchParams.get('error');
  if (error) {
    return NextResponse.redirect(`${BASE_URL}/login?error=${encodeURIComponent(error)}`);
  }

  // Bounce to DSH OAuth flow
  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || '1279582181768957963';
  const dshCallback = 'https://discord-stream-hub-new.fly.dev/api/discord/oauth/callback';
  const discordUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(dshCallback)}&response_type=code&scope=identify%20email&state=hearmeout`;
  return NextResponse.redirect(discordUrl);
}
