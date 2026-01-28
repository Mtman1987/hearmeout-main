import { NextRequest, NextResponse } from 'next/server';
import { TwitchChatService } from '@/lib/twitch-chat-service';

/**
 * POST /api/twitch/initialize
 * Body: { username: string, token: string, clientId: string }
 * Initializes Twitch chat client
 */
export async function POST(req: NextRequest) {
  try {
    const { username, token, clientId } = await req.json();

    if (!username || !token || !clientId) {
      return NextResponse.json(
        { error: 'Missing username, token, or clientId' },
        { status: 400 }
      );
    }

    await TwitchChatService.initialize({ username, token, clientId });

    return NextResponse.json({ success: true, message: 'Twitch chat initialized' });
  } catch (error) {
    console.error('Twitch init error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to initialize',
      },
      { status: 500 }
    );
  }
}
