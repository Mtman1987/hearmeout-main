import { NextRequest, NextResponse } from 'next/server';
import { DiscordChatService } from '@/lib/discord-chat-service';

/**
 * GET /api/discord/messages?channelId=xyz&limit=50
 * Returns recent messages from a channel
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const channelId = searchParams.get('channelId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const botToken = req.headers.get('X-Discord-Token');

    if (!channelId) {
      return NextResponse.json(
        { error: 'Missing channelId parameter' },
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

    const messages = await DiscordChatService.getChannelMessages(channelId, limit);

    return NextResponse.json(messages);
  } catch (error) {
    console.error('Discord messages error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch messages',
      },
      { status: 500 }
    );
  }
}
