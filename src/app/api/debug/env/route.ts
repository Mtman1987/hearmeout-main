import { NextResponse } from 'next/server';

/**
 * GET /api/debug/env
 * Returns status of critical environment variables (never expose actual values)
 * WARNING: Only for development/debugging - remove in production
 */
export async function GET() {
  // Temporarily allow in production for debugging
  // TODO: Remove after fixing env var issues

  const envStatus = {
    nodeEnv: process.env.NODE_ENV,
    livekit: {
      apiKeySet: !!process.env.LIVEKIT_API_KEY,
      apiKeyLength: process.env.LIVEKIT_API_KEY?.length || 0,
      apiSecretSet: !!process.env.LIVEKIT_API_SECRET,
      apiSecretLength: process.env.LIVEKIT_API_SECRET?.length || 0,
      urlSet: !!process.env.NEXT_PUBLIC_LIVEKIT_URL,
      url: process.env.NEXT_PUBLIC_LIVEKIT_URL || 'NOT SET',
    },
    discord: {
      clientIdSet: !!process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID,
      clientId: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || 'NOT SET',
      secretSet: !!process.env.DISCORD_CLIENT_SECRET,
    },
    twitch: {
      clientIdSet: !!process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID,
      clientId: process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || 'NOT SET',
      secretSet: !!process.env.TWITCH_CLIENT_SECRET,
    },
    firebase: {
      apiKeySet: !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomainSet: !!process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectIdSet: !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'NOT SET',
    },
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL || 'NOT SET',
  };

  return NextResponse.json(envStatus);
}
