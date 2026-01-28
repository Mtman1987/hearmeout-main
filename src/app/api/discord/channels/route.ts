import { NextRequest, NextResponse } from 'next/server';
import { DiscordChatService } from '@/lib/discord-chat-service';

/**
 * GET /api/discord/channels?guildId=xyz
 * Returns list of channels in a guild
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const guildId = searchParams.get('guildId');
    const botToken = req.headers.get('X-Discord-Token');

    if (!guildId) {
      return NextResponse.json(
        { error: 'Missing guildId parameter' },
        { status: 400 }
      );
    }

    if (!botToken) {
      return NextResponse.json(
        { error: 'Missing X-Discord-Token header' },
        { status: 401 }
      );
    }

    // Initialize service with token
    DiscordChatService.initialize(botToken);

    const channels = await DiscordChatService.getChannels(guildId);

    return NextResponse.json(channels);
  } catch (error) {
    console.error('Discord channels error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch channels',
      },
      { status: 500 }
    );
  }
}
