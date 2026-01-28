import { NextRequest, NextResponse } from 'next/server';
import { TwitchChatService } from '@/lib/twitch-chat-service';

/**
 * POST /api/twitch/send
 * Body: { channelName: string, message: string }
 * Sends a message to Twitch chat
 */
export async function POST(req: NextRequest) {
  try {
    const { channelName, message } = await req.json();

    if (!channelName || !message) {
      return NextResponse.json(
        { error: 'Missing channelName or message' },
        { status: 400 }
      );
    }

    await TwitchChatService.sendMessage(channelName, message);

    return NextResponse.json({ success: true, message: 'Message sent' });
  } catch (error) {
    console.error('Twitch send error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to send message',
      },
      { status: 500 }
    );
  }
}
