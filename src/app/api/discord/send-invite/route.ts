import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/runtime-config';

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

function resolveRoomUrl(roomUrl: string): string {
  if (/^https?:\/\//i.test(roomUrl)) {
    return roomUrl;
  }

  const baseUrl = getBaseUrl();
  const normalizedPath = roomUrl.startsWith('/') ? roomUrl : `/${roomUrl}`;
  return `${baseUrl}${normalizedPath}`;
}

export async function POST(req: NextRequest) {
  try {
    const { userId, roomUrl, expiresAt } = await req.json();

    if (!userId || !roomUrl) {
      return errorResponse('Missing userId or roomUrl', 400);
    }

    const discordBotToken = process.env.DISCORD_BOT_TOKEN;
    if (!discordBotToken) {
      return errorResponse('Bot not configured', 500);
    }

    const inviteUrl = resolveRoomUrl(roomUrl);

    // Create DM channel
    const dmChannelRes = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${discordBotToken}`,
      },
      body: JSON.stringify({ recipient_id: userId }),
    });

    if (!dmChannelRes.ok) {
      const details = await readDiscordError(dmChannelRes);
      return errorResponse('Failed to create DM channel', dmChannelRes.status, details);
    }

    const dmChannel = await dmChannelRes.json();

    // Send message
    const messageRes = await fetch(`${DISCORD_API_BASE}/channels/${dmChannel.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${discordBotToken}`,
      },
      body: JSON.stringify({
        content: `🎤 **It's your turn to join the voice chat!**\n\n${inviteUrl}\n\n⏰ This link expires at: ${expiresAt}\n\nJoin now and have fun!`,
      }),
    });

    if (!messageRes.ok) {
      const details = await readDiscordError(messageRes);
      return errorResponse('Failed to send DM', messageRes.status, details);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending Discord DM:', error);
    return errorResponse('Failed to send DM', 500);
  }
}