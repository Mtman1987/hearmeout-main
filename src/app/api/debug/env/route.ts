import { NextResponse } from 'next/server';
import { getBaseUrl, getDiscordClientId, getDshUrl, getHardcodedGuildId } from '@/lib/runtime-config';

// Diagnostic helper: was an env var actually configured? The runtime-config
// getters always return a non-empty string thanks to fallback constants, so
// using them for `*Set` booleans would always read `true` and defeat the
// purpose of this debug endpoint.
const isEnvConfigured = (...keys: string[]) =>
  keys.some((k) => {
    const v = process.env[k];
    return typeof v === 'string' && v.trim() !== '';
  });

export async function GET() {
  const envStatus = {
    nodeEnv: process.env.NODE_ENV,
    livekit: {
      apiKeySet: !!process.env.LIVEKIT_API_KEY,
      apiSecretSet: !!process.env.LIVEKIT_API_SECRET,
      url: process.env.NEXT_PUBLIC_LIVEKIT_URL || 'NOT SET',
    },
    discord: {
      clientIdSet: isEnvConfigured('NEXT_PUBLIC_DISCORD_CLIENT_ID', 'DISCORD_CLIENT_ID'),
      clientId: getDiscordClientId(),
      secretSet: !!process.env.DISCORD_CLIENT_SECRET,
      dshUrlSet: isEnvConfigured('DSH_URL', 'NEXT_PUBLIC_DSH_URL'),
      dshUrl: getDshUrl(),
      guildIdSet: isEnvConfigured('HARDCODED_GUILD_ID', 'DISCORD_GUILD_ID'),
      guildId: getHardcodedGuildId(),
    },
    twitch: {
      clientIdSet: !!process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID,
      secretSet: !!process.env.TWITCH_CLIENT_SECRET,
    },
    database: {
      dbFile: process.env.DB_FILE || '/data/app.db',
      musicCacheDir: process.env.MUSIC_CACHE_DIR || '/data/music',
    },
    baseUrl: getBaseUrl(),
  };

  return NextResponse.json(envStatus);
}