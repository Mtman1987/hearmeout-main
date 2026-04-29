import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { setSessionCookie } from '@/lib/auth';
import { enrichUserFromDSH } from '@/lib/enrich-user';
import { config } from '@/lib/config';
import { verifyDshRedirect } from '@/lib/dsh-redirect';

const BASE_URL = config.baseUrl;

export async function GET(req: NextRequest) {
  await ensureDb();

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.redirect(`${BASE_URL}/login?error=no_user_id`);
    }

    // Account-takeover protection (audit S12)
    const verify = verifyDshRedirect('discord', searchParams);
    if (!verify.ok) {
      console.warn('[auth/complete] rejected unsigned redirect:', verify.reason);
      return NextResponse.redirect(`${BASE_URL}/login?error=invalid_dsh_redirect`);
    }

    const uid = userId.startsWith('discord_') ? userId : `discord_${userId}`;
    const existing = db.get('users', uid);
    if (existing) {
      await setSessionCookie(uid);
      enrichUserFromDSH(userId).catch(() => {});
      return NextResponse.redirect(`${BASE_URL}/`);
    }

    // User not in local DB yet — try enriching from DSH first
    const enriched = await enrichUserFromDSH(userId);
    if (enriched) {
      await setSessionCookie(uid);
      return NextResponse.redirect(`${BASE_URL}/`);
    }

    return NextResponse.redirect(`${BASE_URL}/login?error=user_not_found`);
  } catch (error) {
    console.error('Auth completion error:', error);
    return NextResponse.redirect(`${BASE_URL}/login?error=completion_failed`);
  }
}
