import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const channelId = searchParams.get('channelId');
    const limit = searchParams.get('limit') || '50';
    const after = searchParams.get('after');

    if (!channelId) {
      return NextResponse.json({ error: 'Missing channelId' }, { status: 400 });
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ error: 'Bot not configured' }, { status: 500 });
    }

    const url = after
      ? `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}&after=${after}`
      : `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bot ${botToken}`,
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: response.status });
    }

    const messages = await response.json();
    return NextResponse.json(messages);
  } catch (error) {
    console.error('Error fetching Discord messages:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
