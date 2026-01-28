import { NextRequest, NextResponse } from 'next/server';
import { TwitchChatService } from '@/lib/twitch-chat-service';

/**
 * POST /api/twitch/join
 * Body: { channelName: string }
 * Joins a Twitch channel
 */
export async function POST(req: NextRequest) {
  try {
    const { channelName } = await req.json();

    if (!channelName) {
      return NextResponse.json(
        { error: 'Missing channelName' },
        { status: 400 }
      );
    }

    await TwitchChatService.joinChannel(channelName);

    return NextResponse.json({ success: true, message: `Joined ${channelName}` });
  } catch (error) {
    console.error('Twitch join error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to join channel',
      },
      { status: 500 }
    );
  }
}
