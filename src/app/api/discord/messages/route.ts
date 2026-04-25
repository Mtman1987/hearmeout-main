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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const channelId = searchParams.get('channelId');
    const limit = searchParams.get('limit') || '50';
    const after = searchParams.get('after');

    if (!channelId) {
      return errorResponse('Missing channelId', 400);
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) {
      return errorResponse('Bot not configured', 500);
    }

    const url = after
      ? `${DISCORD_API_BASE}/channels/${channelId}/messages?limit=${limit}&after=${after}`
      : `${DISCORD_API_BASE}/channels/${channelId}/messages?limit=${limit}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    if (!response.ok) {
      const details = await readDiscordError(response);
      return errorResponse('Failed to fetch messages', response.status, details);
    }

    const messages = await response.json();
    return NextResponse.json(messages);
  } catch (error) {
    console.error('Error fetching Discord messages:', error);
    return errorResponse('Internal error', 500);
  }
}