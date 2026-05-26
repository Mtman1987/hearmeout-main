import { NextRequest, NextResponse } from 'next/server';
import { TwitchChatService } from '@/lib/twitch-chat-service';
import { getSession } from '@/lib/auth';

/**
 * POST /api/twitch/join
 * Body: { channelName: string }
 * Joins a Twitch channel
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
