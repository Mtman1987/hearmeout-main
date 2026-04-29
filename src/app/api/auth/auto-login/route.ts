import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { setSessionCookie } from '@/lib/auth';
import { enrichUserFromDSH } from '@/lib/enrich-user';
import { config } from '@/lib/config';
import { verifyDshRedirect } from '@/lib/dsh-redirect';

const DSH_URL = config.dshUrl;
const DB_API_KEY = config.dbApiKey;

export async function POST(req: NextRequest) {
  await ensureDb();

  try {
    const body = await req.json().catch(() => ({}));
    const targetUserId = body.userId; // specific user ID from DSH redirect

    // Account-takeover protection (audit S11): require a valid DSH signature
    // before we'll set a session cookie for an arbitrary user_id.
    // body.exp + body.sig are forwarded from DSH's redirect query.
    if (targetUserId) {
      const verifyParams = new URLSearchParams();
      verifyParams.set('user_id', String(targetUserId));
      if (body.exp) verifyParams.set('exp', String(body.exp));
      if (body.sig) verifyParams.set('sig', String(body.sig));
      const verify = verifyDshRedirect('discord', verifyParams);
      if (!verify.ok) {
        console.warn('[auto-login] rejected unsigned request:', verify.reason);
        return NextResponse.json(
          { success: false, error: 'invalid_dsh_signature' },
          { status: 401 },
        );
      }
    }

    // If a specific user ID was provided, look up that exact user
    if (targetUserId) {
      const uid = targetUserId.startsWith('discord_') ? targetUserId : `discord_${targetUserId}`;
      const existing = db.get('users', uid);
      if (existing) {
        await setSessionCookie(uid);
        // Enrich in background — don't block login
        enrichUserFromDSH(targetUserId).catch(() => {});
        return NextResponse.json({ success: true, user: existing });
      }
      // Try fetching from DSH
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (DB_API_KEY) headers['x-api-key'] = DB_API_KEY;
      const res = await fetch(`${DSH_URL}/api/db?path=tokens/user_${targetUserId}_discord`, { headers });
      if (res.ok) {
        const tokenData = await res.json();
        if (tokenData.exists && tokenData.data) {
          const d = tokenData.data;
          const photoURL = d.avatar ? `https://cdn.discordapp.com/avatars/${d.user_id}/${d.avatar}.png` : null;
          db.set('users', uid, {
            id: uid, username: d.username, displayName: d.username, photoURL,
            discordId: d.user_id || targetUserId, source: 'auto-login',
          });
          await setSessionCookie(uid);
          enrichUserFromDSH(targetUserId).catch(() => {});
          return NextResponse.json({ success: true, user: { username: d.username } });
        }
      }
    }

    // No userId provided and no fallback — require OAuth
    return NextResponse.json({
      success: false,
      error: 'No user ID provided. Please sign in via Discord OAuth.'
    }, { status: 400 });

  } catch (error) {
    console.error('[Auto-Login] Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to check existing user data' }, { status: 500 });
  }
}