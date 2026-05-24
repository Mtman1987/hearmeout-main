import { NextRequest, NextResponse } from 'next/server';
import { handleMusicCommand } from '@/lib/music-command-service';
import { handleWatchRequestCommand } from '@/lib/watch/watch-request-service';

function getRequestBaseUrl(request: NextRequest) {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const proto = forwardedProto || request.nextUrl.protocol.replace(':', '');
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host;
  return `${proto}://${host}`;
}

function timeoutSignal(milliseconds: number) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

async function sendDiscordMessage(channelId: string, content: string, username?: string) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return { ok: false, error: 'DISCORD_BOT_TOKEN is not configured' };

  try {
    const webhooksRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
      headers: { Authorization: `Bot ${botToken}` },
      signal: timeoutSignal(7_000),
    });

    if (webhooksRes.ok) {
      const webhooks = await webhooksRes.json();
      let webhook = Array.isArray(webhooks) ? webhooks.find((entry: any) => entry.name === 'HearMeOut') : null;

      if (!webhook) {
        const createRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
          method: 'POST',
          headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'HearMeOut' }),
          signal: timeoutSignal(7_000),
        });
        if (createRes.ok) webhook = await createRes.json();
      }

      if (webhook?.id && webhook?.token) {
        const sendRes = await fetch(`https://discord.com/api/v10/webhooks/${webhook.id}/${webhook.token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, username: username || 'HearMeOut' }),
          signal: timeoutSignal(7_000),
        });
        if (sendRes.ok) return { ok: true, via: 'webhook' };
      }
    }

    return { ok: false, error: `Webhook unavailable for channel ${channelId}` };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Discord send failed' };
  }
}

export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      const raw = await request.text();
      body = JSON.parse(raw.replace(/[\x00-\x1F\x7F]/g, ''));
    }
    const data = body.root || body;
    const message = String(data.message || data.content || '').trim();
    const channelId = String(data.channelId || '').trim();
    const guildId = String(data.guildId || data.serverId || 'local').trim();
    const userId = String(data.userId || data.authorId || 'discord').trim();
    const userName = String(data.userName || data.displayName || data.username || 'Discord User').trim();
    const replies: string[] = [];

    if (!message) {
      return NextResponse.json({ success: true, handled: false, skipped: 'empty message' });
    }

    if (!channelId) {
      return NextResponse.json({ success: false, error: 'Missing channelId' }, { status: 400 });
    }

    let handled = await handleWatchRequestCommand({
      message,
      discordUserId: userId,
      discordUserName: userName,
      guildId,
      channelId,
      userMessageId: data.messageId || data.id,
      publicBaseUrl: getRequestBaseUrl(request),
      reply: (content) => {
        replies.push(content);
      },
    });

    if (!handled) {
      handled = await handleMusicCommand({
        message,
        userId,
        username: userName,
        platform: 'discord',
        reply: (content) => {
          replies.push(content);
        },
      });
    }

    const discordSends = handled
      ? await Promise.all(replies.map((reply) => sendDiscordMessage(channelId, reply, 'HearMeOut')))
      : [];

    return NextResponse.json({ success: true, handled, replies, reply: replies[0] || null, discordSends });
  } catch (error) {
    console.error('[Discord Chat] watch command failed:', error);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
