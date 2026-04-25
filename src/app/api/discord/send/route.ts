import { NextRequest, NextResponse } from 'next/server';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

async function readDiscordError(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text) return response.statusText || 'Unknown error';

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return response.statusText || 'Unknown error';
  }
}

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    details === undefined ? { error: message } : { error: message, details },
    { status }
  );
}

export async function POST(req: NextRequest) {
  try {
    const { channelId, content, username, avatarUrl } = await req.json();

    if (!channelId || !content) {
      return errorResponse('Missing channelId or content', 400);
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return errorResponse('Bot not configured', 500);
    }

    // Get or create webhook for channel
    const webhooksRes = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/webhooks`, {
      headers: { Authorization: `Bot ${botToken}` },
    });

    let webhookUrl: string | null = null;
    if (webhooksRes.ok) {
      const webhooks = await webhooksRes.json();
      const existingWebhook = Array.isArray(webhooks)
        ? webhooks.find((w: any) => w.name === 'HearMeOut' && w.id && w.token)
        : null;

      if (existingWebhook) {
        webhookUrl = `${DISCORD_API_BASE}/webhooks/${existingWebhook.id}/${existingWebhook.token}`;
      } else {
        const createRes = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/webhooks`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'HearMeOut' }),
        });

        if (createRes.ok) {
          const webhook = await createRes.json();
          if (webhook?.id && webhook?.token) {
            webhookUrl = `${DISCORD_API_BASE}/webhooks/${webhook.id}/${webhook.token}`;
          }
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
        const details = await readDiscordError(response);
        return errorResponse('Failed to send message', response.status, details);
      }

      return NextResponse.json({ success: true });
    }

    // Fallback to bot message
    const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      const details = await readDiscordError(response);
      return errorResponse('Failed to send message', response.status, details);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending Discord message:', error);
    return errorResponse('Internal error', 500);
  }
}