import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { setSessionCookie } from '@/lib/auth';
import { enrichUserFromDSH } from '@/lib/enrich-user';
import { getBaseUrl, getDbApiKey, getDiscordClientId, getDshUrl } from '@/lib/runtime-config';

export async function GET(req: NextRequest) {
  await ensureDb();
  const { searchParams } = new URL(req.url);

  const baseUrl = getBaseUrl();
  const dshUrl = getDshUrl();
  const dbApiKey = getDbApiKey();

  // Check if DSH OAuth was successful
  const success = searchParams.get('success');
  const userId = searchParams.get('user_id');
  if (success === 'true' && userId) {
    try {
      const headers: Record<string, string> = {};
      if (dbApiKey) headers['x-api-key'] = dbApiKey;

      const response = await fetch(`${dshUrl}/api/db?path=tokens/user_${userId}_discord`, { headers });
      if (response.ok) {
        const tokenData = await response.json();
        if (tokenData.exists && tokenData.data) {
          const d = tokenData.data;
          const discordUserId = d.user_id || d.userId || userId;
          const username = d.username;
          const avatar = d.avatar;

          const uid = `discord_${discordUserId}`;
          const photoURL = avatar
            ? avatar.startsWith('http')
              ? avatar
              : `https://cdn.discordapp.com/avatars/${discordUserId}/${avatar}.png`
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
          return NextResponse.redirect(`${baseUrl}/`);
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

    const existing = await db.getAsync('users', uid);
    if (!existing) {
      const avatar = searchParams.get('avatar');
      const photoURL = avatar
        ? avatar.startsWith('http')
          ? avatar
          : `https://cdn.discordapp.com/avatars/${legacyUserId}/${avatar}.png`
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
    return NextResponse.redirect(`${baseUrl}/`);
  }

  const error = searchParams.get('error');
  if (error) {
    return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(error)}`);
  }

  const clientId = getDiscordClientId();
  const dshCallback = `${dshUrl}/api/discord/oauth/callback`;
  const discordUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(dshCallback)}&response_type=code&scope=identify%20email&state=hearmeout`;
  return NextResponse.redirect(discordUrl);
}
