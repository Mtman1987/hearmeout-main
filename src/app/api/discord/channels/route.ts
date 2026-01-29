import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const guildId = searchParams.get('guildId');

  console.log('[Discord Channels API] Request received for guildId:', guildId);

  if (!guildId) {
    return NextResponse.json({ error: 'Missing guildId' }, { status: 400 });
  }

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
    const textAndVoiceChannels = channels.filter((ch: any) => ch.type === 0 || ch.type === 2);
    console.log('[Discord Channels API] Found channels:', textAndVoiceChannels.length);
    
    return NextResponse.json(textAndVoiceChannels);
  } catch (error) {
    console.error('[Discord Channels API] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
