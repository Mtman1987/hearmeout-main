import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { setSessionCookie } from '@/lib/auth';
import { enrichUserFromDSH } from '@/lib/enrich-user';

const SERVER_ID = process.env.HARDCODED_GUILD_ID || '1240832965865635881';
const DSH_URL = 'https://discord-stream-hub-new.fly.dev';
const DB_API_KEY = process.env.DB_API_KEY || '';

export async function POST(req: NextRequest) {
  await ensureDb();

  try {
    const body = await req.json().catch(() => ({}));
    const targetUserId = body.userId; // specific user ID from DSH redirect

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