import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { userId, roomUrl, expiresAt } = await req.json();

  if (!userId || !roomUrl) {
    return NextResponse.json({ error: 'Missing userId or roomUrl' }, { status: 400 });
  }

  const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  if (!DISCORD_BOT_TOKEN) {
    return NextResponse.json({ error: 'Bot not configured' }, { status: 500 });
  }

  try {
    // Create DM channel
    const dmChannelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({ recipient_id: userId }),
    });

    if (!dmChannelRes.ok) {
      throw new Error('Failed to create DM channel');
    }

    const dmChannel = await dmChannelRes.json();

    // Send message
    const messageRes = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        content: `🎤 **It's your turn to join the voice chat!**\n\n${roomUrl}\n\n⏰ This link expires at: ${expiresAt}\n\nJoin now and have fun!`,
      }),
    });

    if (!messageRes.ok) {
      throw new Error('Failed to send DM');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending Discord DM:', error);
    return NextResponse.json({ error: 'Failed to send DM' }, { status: 500 });
  }
}
