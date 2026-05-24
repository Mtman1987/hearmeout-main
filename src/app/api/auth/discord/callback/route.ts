import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { setSessionCookie } from '@/lib/auth';
import { enrichUserFromDSH } from '@/lib/enrich-user';
import { config } from '@/lib/config';
import { verifyDshRedirect } from '@/lib/dsh-redirect';

const BASE_URL = config.baseUrl;
const DSH_URL = config.dshUrl;

function loginErrorUrl(error: string, description?: string | null) {
  const url = new URL('/login', BASE_URL);
  url.searchParams.set('error', description || error);
  if (description) url.searchParams.set('error_code', error);
  return url.toString();
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const { searchParams } = new URL(req.url);

  // Check if DSH OAuth was successful
  const success = searchParams.get('success');
  const userId = searchParams.get('user_id');
  if (success === 'true' && userId) {
    // Account-takeover protection (audit S10): verify DSH signed this redirect
    const verify = verifyDshRedirect('discord', searchParams);
    if (!verify.ok) {
      console.warn('[auth/discord/callback] rejected unsigned/forged redirect:', verify.reason);
      return NextResponse.redirect(loginErrorUrl('invalid_dsh_redirect', verify.reason));
    }

    const username = searchParams.get('username') || searchParams.get('display_name') || 'Discord User';
    const avatar = searchParams.get('avatar');
    const uid = `discord_${userId}`;
    const photoURL = avatar ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png` : null;

    await db.setAsync('users', uid, {
      id: uid,
      username,
      displayName: searchParams.get('display_name') || username,
      photoURL,
      discordId: userId,
    });

    await setSessionCookie(uid);
    enrichUserFromDSH(userId).catch(() => {});
    return NextResponse.redirect(`${BASE_URL}/`);
  }

  // Legacy flow - DSH redirected here after doing the real OAuth + writing user to shared SQLite
  const legacyUserId = searchParams.get('user_id');
  const username = searchParams.get('username');

  if (legacyUserId && username) {
    // Account-takeover protection (audit S10): legacy flow needs the same
    // signature check as the success-flag branch.
    const verify = verifyDshRedirect('discord', searchParams);
    if (!verify.ok) {
      console.warn('[auth/discord/callback] rejected unsigned/forged legacy redirect:', verify.reason);
      return NextResponse.redirect(loginErrorUrl('invalid_dsh_redirect', verify.reason));
    }
    const uid = `discord_${legacyUserId}`;

    // User already exists in shared SQLite (DSH wrote it) — just set HMO's session cookie
    const existing = await db.getAsync('users', uid);
    if (!existing) {
      const avatar = searchParams.get('avatar');
      const photoURL = avatar
        ? `https://cdn.discordapp.com/avatars/${legacyUserId}/${avatar}.png`
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
    return NextResponse.redirect(loginErrorUrl(error, searchParams.get('error_description')));
  }

  // Bounce to DSH OAuth flow
  const clientId = config.discordClientId;
  const dshCallback = `${DSH_URL}/api/discord/oauth/callback`;
  const discordUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(dshCallback)}&response_type=code&scope=identify%20email&state=hearmeout`;
  return NextResponse.redirect(discordUrl);
}
