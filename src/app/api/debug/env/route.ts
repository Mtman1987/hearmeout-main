import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, ensureDb } from '@/lib/db';

export async function GET() {
  // Only allow in development or for admin users
  if (process.env.NODE_ENV === 'production') {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await ensureDb();
    const userDoc = db.get('users', session.uid);
    if (!userDoc?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const envStatus = {
    nodeEnv: process.env.NODE_ENV,
    livekit: {
      apiKeySet: !!process.env.LIVEKIT_API_KEY,
      apiSecretSet: !!process.env.LIVEKIT_API_SECRET,
      urlSet: !!process.env.NEXT_PUBLIC_LIVEKIT_URL,
    },
    discord: {
      clientIdSet: !!process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID,
      secretSet: !!process.env.DISCORD_CLIENT_SECRET,
    },
    twitch: {
      clientIdSet: !!process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID,
      secretSet: !!process.env.TWITCH_CLIENT_SECRET,
    },
    database: {
      dbFileSet: !!process.env.DB_FILE,
      musicCacheDirSet: !!process.env.MUSIC_CACHE_DIR,
    },
    baseUrlSet: !!process.env.NEXT_PUBLIC_BASE_URL,
  };

  return NextResponse.json(envStatus);
}
