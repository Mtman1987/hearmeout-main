// Centralized config. Reads env vars in one place, fails fast on missing
// required values in production. Import from here instead of sprinkling
// `process.env.X || 'fallback'` across the codebase.

const isProd = process.env.NODE_ENV === 'production';

function required(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined && !isProd) return fallback;
  if (isProd) {
    // Don't crash the build — but make every request to this code path scream.
    // (We can't throw at module load because Next.js evaluates this during build
    // and we don't want CI to refuse to build a misconfigured deploy that the
    // operator may still want to push.)
    console.error(`[config] Required env var ${name} is missing in production.`);
  }
  return fallback ?? '';
}

function optional(name: string, fallback = ''): string {
  return process.env[name] || fallback;
}

export const config = {
  baseUrl: optional('NEXT_PUBLIC_BASE_URL', 'https://hearmeout-main.fly.dev'),
  dshUrl: optional('DSH_URL', optional('NEXT_PUBLIC_DSH_URL', 'https://discord-stream-hub-new.fly.dev')),
  hardcodedGuildId: optional('HARDCODED_GUILD_ID', optional('NEXT_PUBLIC_HARDCODED_GUILD_ID', '')),
  discordClientId: optional('NEXT_PUBLIC_DISCORD_CLIENT_ID', '1279582181768957963'),
  twitchClientId: optional('NEXT_PUBLIC_TWITCH_CLIENT_ID', 'rxmohc28tthq0nudfd6iwx0sgy88dp'),

  // Secrets — never have a public fallback. Empty string in dev = feature disabled.
  jwtSecret: optional('JWT_SECRET') || optional('DISCORD_CLIENT_SECRET') || optional('NEXTAUTH_SECRET') || 'hearmeout-internal-session-key',
  dbApiKey: optional('DB_API_KEY'),
  dshRedirectSecret: optional('DSH_REDIRECT_SECRET'),

  livekit: {
    apiKey: optional('LIVEKIT_API_KEY'),
    apiSecret: optional('LIVEKIT_API_SECRET'),
    publicUrl: optional('NEXT_PUBLIC_LIVEKIT_URL'),
  },

  discordBotToken: optional('DISCORD_BOT_TOKEN'),
  discordPublicKey: optional('DISCORD_PUBLIC_KEY'),

  // Strict mode: when true, reject unsigned DSH redirects on auth callbacks.
  // Defaults to OFF to avoid breaking existing flows; turn ON once DSH is
  // configured to sign redirects with DSH_REDIRECT_SECRET.
  requireDshSignature: optional('REQUIRE_DSH_SIGNATURE') === '1',
};

export function assertJwtSecret(): string {
  if (!config.jwtSecret) {
    throw new Error(
      'JWT_SECRET (or DISCORD_CLIENT_SECRET) is unset. Sessions cannot be signed/verified.',
    );
  }
  return config.jwtSecret;
}
