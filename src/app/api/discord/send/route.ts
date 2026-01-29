import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { channelId, content, username, avatarUrl } = await req.json();

    if (!channelId || !content) {
      return NextResponse.json({ error: 'Missing channelId or content' }, { status: 400 });
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ error: 'Bot not configured' }, { status: 500 });
    }

    // Get or create webhook for channel
    const webhooksRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
      headers: { 'Authorization': `Bot ${botToken}` },
    });

    let webhookUrl;
    if (webhooksRes.ok) {
      const webhooks = await webhooksRes.json();
      const existingWebhook = webhooks.find((w: any) => w.name === 'HearMeOut');
      
      if (existingWebhook) {
        webhookUrl = `https://discord.com/api/v10/webhooks/${existingWebhook.id}/${existingWebhook.token}`;
      } else {
        // Create webhook
        const createRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
          method: 'POST',
          headers: {
            'Authorization': `Bot ${botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'HearMeOut' }),
        });
        
        if (createRes.ok) {
          const webhook = await createRes.json();
          webhookUrl = `https://discord.com/api/v10/webhooks/${webhook.id}/${webhook.token}`;
        }
      }
    }

    // Send via webhook with user impersonation
    if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          username: username || 'HearMeOut User',
          avatar_url: avatarUrl,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return NextResponse.json({ error: 'Failed to send message', details: error }, { status: response.status });
      }

      return NextResponse.json({ success: true });
    }

    // Fallback to bot message
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
