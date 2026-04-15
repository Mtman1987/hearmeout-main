import { NextResponse } from 'next/server';

export async function GET() {
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
