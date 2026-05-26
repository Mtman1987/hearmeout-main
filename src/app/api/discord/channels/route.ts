import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

type CachedChannels = { channels: any[], timestamp: number };

const cache = new Map<string, CachedChannels>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const guildId = searchParams.get('guildId');

  if (!guildId) {
    return NextResponse.json({ error: 'Missing guildId' }, { status: 400 });
  }

  // Check cache
  const cached = cache.get(guildId);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    console.log(`[Discord Channels API] Cache hit for guild ${guildId} (${cached.channels.length} channels)`);
    return NextResponse.json(cached.channels);
  }

  console.log(`[Discord Channels API] Cache miss - fetching for guildId:`, guildId);

  const botToken = process.env.DISCORD_BOT_TOKEN;
  console.log('[Discord Channels API] Bot token exists:', !!botToken);
  
  if (!botToken) {
    return NextResponse.json({ error: 'Bot not configured' }, { status: 500 });
  }

  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: {
        'Authorization': `Bot ${botToken}`,
      },
    });

    console.log('[Discord Channels API] Discord API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Discord Channels API] Discord API error:', errorText);
      return NextResponse.json({ error: 'Failed to fetch channels' }, { status: response.status });
    }

    const channels = await response.json();
    console.log(`[Discord Channels API] Fetched ${channels.length} channels for ${guildId}`);
    
    // Cache result
    cache.set(guildId, { channels, timestamp: now });
    
    return NextResponse.json(channels);
  } catch (error) {
    console.error('[Discord Channels API] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
