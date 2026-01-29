import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { channelId, content } = await req.json();

    if (!channelId || !content) {
      return NextResponse.json({ error: 'Missing channelId or content' }, { status: 400 });
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ error: 'Bot not configured' }, { status: 500 });
    }

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json({ error: 'Failed to send message', details: error }, { status: response.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending Discord message:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
