import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Only allow admin users to view environment debug info
  const { db, ensureDb } = await import('@/lib/db');
  await ensureDb();
  const userDoc = db.get('users', session.uid);
  if (!userDoc?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const envStatus = {
    nodeEnv: process.env.NODE_ENV,
    livekit: {
      apiKeySet: !!process.env.LIVEKIT_API_KEY,
      apiSecretSet: !!process.env.LIVEKIT_API_SECRET,
      url: process.env.NEXT_PUBLIC_LIVEKIT_URL || 'NOT SET',
    },
    discord: {
      clientIdSet: !!process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID,
      clientId: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || 'NOT SET',
      secretSet: !!process.env.DISCORD_CLIENT_SECRET,
    },
    twitch: {
      clientIdSet: !!process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID,
      secretSet: !!process.env.TWITCH_CLIENT_SECRET,
    },
    database: {
      dbFile: process.env.DB_FILE || '/data/app.db',
      musicCacheDir: process.env.MUSIC_CACHE_DIR || '/data/music',
    },
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL || 'NOT SET',
  };

  return NextResponse.json(envStatus);
}
