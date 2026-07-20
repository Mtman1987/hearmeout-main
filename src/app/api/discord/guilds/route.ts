import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { DiscordChatService } from '@/lib/discord-chat-service';
import { config } from '@/lib/config';

// Lists the Discord servers (guilds) the bot is a member of, so a room owner
// can pick which server's voice channel the bridge should join.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const botToken = config.discordBotToken;
  if (!botToken) return NextResponse.json({ error: 'Bot not configured' }, { status: 500 });

  try {
    DiscordChatService.initialize(botToken);
    const guilds = await DiscordChatService.getGuilds();
    return NextResponse.json(guilds);
  } catch (error) {
    console.error('[Discord Guilds API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch guilds' }, { status: 500 });
  }
}
