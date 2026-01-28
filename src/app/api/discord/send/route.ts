import { NextRequest, NextResponse } from 'next/server';
import { DiscordChatService } from '@/lib/discord-chat-service';

/**
 * POST /api/discord/send
 * Body: { channelId: string, content: string }
 * Sends a message to a Discord channel
 */
export async function POST(req: NextRequest) {
  try {
    const botToken = req.headers.get('X-Discord-Token');

    if (!botToken) {
      return NextResponse.json(
        { error: 'Missing X-Discord-Token header' },
        { status: 401 }
      );
    }

    const { channelId, content } = await req.json();

    if (!channelId || !content) {
      return NextResponse.json(
        { error: 'Missing channelId or content' },
        { status: 400 }
      );
    }

    // Initialize service with token
    DiscordChatService.initialize(botToken);

    const messageId = await DiscordChatService.sendMessage(channelId, content);

    return NextResponse.json({ id: messageId, success: true });
  } catch (error) {
    console.error('Discord send error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to send message',
      },
      { status: 500 }
    );
  }
}
