import { NextRequest, NextResponse } from 'next/server';

type CachedChannels = { channels: any[]; timestamp: number };

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const cache = new Map<string, CachedChannels>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function readDiscordError(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text) return response.statusText || 'Unknown error';

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return response.statusText || 'Unknown error';
  }
}

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    details === undefined ? { error: message } : { error: message, details },
    { status }
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const guildId = searchParams.get('guildId');

  if (!guildId) {
    return errorResponse('Missing guildId', 400);
  }

  const cached = cache.get(guildId);
  const now = Date.now();
  if (cached && now - cached.timestamp < CACHE_TTL) {
    console.log(`[Discord Channels API] Cache hit for guild ${guildId} (${cached.channels.length} channels)`);
    return NextResponse.json(cached.channels);
  }

  console.log(`[Discord Channels API] Cache miss - fetching for guildId:`, guildId);

  const botToken = process.env.DISCORD_BOT_TOKEN;
  console.log('[Discord Channels API] Bot token exists:', !!botToken);

  if (!botToken) {
    return errorResponse('Bot not configured', 500);
  }

  try {
    const response = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    console.log('[Discord Channels API] Discord API response status:', response.status);

    if (!response.ok) {
      const details = await readDiscordError(response);
      console.error('[Discord Channels API] Discord API error:', details);
      return errorResponse('Failed to fetch channels', response.status, details);
    }

    const channels = await response.json();
    console.log(`[Discord Channels API] Fetched ${channels.length} channels for ${guildId}`);

    cache.set(guildId, { channels, timestamp: now });

    return NextResponse.json(channels);
  } catch (error) {
    console.error('[Discord Channels API] Error:', error);
    return errorResponse('Internal error', 500);
  }
}