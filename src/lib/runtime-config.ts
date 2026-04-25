const FALLBACK_BASE_URL = 'https://hearmeout-main.fly.dev';
const FALLBACK_DSH_URL = 'https://discord-stream-hub-new.fly.dev';
const FALLBACK_DISCORD_CLIENT_ID = '1279582181768957963';
const FALLBACK_GUILD_ID = '1240832965865635881';

function normalizeUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function normalizeDiscordId(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function firstValid<T>(values: Array<T | null | undefined>, validator: (value: T) => boolean): T | null {
  for (const value of values) {
    if (value != null && validator(value)) {
      return value;
    }
  }

  return null;
}

export function getBaseUrl(): string {
  const configured = firstValid(
    [
      normalizeUrl(process.env.NEXT_PUBLIC_BASE_URL),
      normalizeUrl(process.env.BASE_URL),
      process.env.VERCEL_URL ? normalizeUrl(`https://${process.env.VERCEL_URL}`) : null,
      process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : null,
    ],
    (value) => Boolean(value)
  );

  return configured || FALLBACK_BASE_URL;
}

export function getDshUrl(): string {
  const configured = firstValid(
    [
      normalizeUrl(process.env.DSH_URL),
      normalizeUrl(process.env.NEXT_PUBLIC_DSH_URL),
      process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null,
    ],
    (value) => Boolean(value)
  );

  return configured || FALLBACK_DSH_URL;
}

export function getDiscordClientId(): string {
  const configured = firstValid(
    [
      normalizeDiscordId(process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID),
      normalizeDiscordId(process.env.DISCORD_CLIENT_ID),
    ],
    (value) => Boolean(value)
  );

  return configured || FALLBACK_DISCORD_CLIENT_ID;
}

export function getHardcodedGuildId(): string {
  const configured = firstValid(
    [
      normalizeDiscordId(process.env.HARDCODED_GUILD_ID),
      normalizeDiscordId(process.env.DISCORD_GUILD_ID),
    ],
    (value) => Boolean(value)
  );

  return configured || FALLBACK_GUILD_ID;
}

export function getDbApiKey(): string {
  return process.env.DB_API_KEY?.trim() || '';
}