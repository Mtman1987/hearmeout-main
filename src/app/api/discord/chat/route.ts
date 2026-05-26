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

function getStreamweaverDiscordChatUrl() {
  const baseUrl = (
    process.env.STREAMWEAVER_URL ||
    process.env.STREAMWEAVE_URL ||
    process.env.NEXT_PUBLIC_STREAMWEAVE_URL ||
    'https://streamweaver-new.fly.dev'
  ).replace(/\/$/, '');
  return process.env.STREAMWEAVER_DISCORD_CHAT_URL || `${baseUrl}/api/discord/chat`;
}

async function forwardToStreamweaver(originalBody: any) {
  const response = await fetch(getStreamweaverDiscordChatUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(originalBody),
    signal: timeoutSignal(15_000),
  });
  const payload = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

async function sendDiscordMessage(channelId: string, content: string, username?: string, components?: any[]) {
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
          body: JSON.stringify({ content, username: username || 'HearMeOut', components }),
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

function watchControlComponents(baseUrl: string) {
  const sessionId = 'discord-watch-room';
  const controlUrl = (action: string) => `${baseUrl}/api/watch/sessions/${sessionId}/quick-control?action=${encodeURIComponent(action)}`;
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 5, label: 'Play', url: controlUrl('play') },
        { type: 2, style: 5, label: 'Pause', url: controlUrl('pause') },
        { type: 2, style: 5, label: 'Sync', url: controlUrl('seek') },
        { type: 2, style: 5, label: 'Next', url: controlUrl('next') },
        { type: 2, style: 5, label: 'Clear', url: controlUrl('clear') },
      ],
    },
  ];
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
    const controlComponents = /^!(controls?|watch-controls)$/i.test(message)
      ? watchControlComponents(getRequestBaseUrl(request))
      : null;

    if (!message) {
      return NextResponse.json({ success: true, handled: false, skipped: 'empty message' });
    }

    if (!channelId) {
      return NextResponse.json({ success: false, error: 'Missing channelId' }, { status: 400 });
    }

    const alreadyFannedOutByDiscordStreamHub = request.headers.get('x-chat-origin') === 'dsh-fanout';
    const streamweaverForward = alreadyFannedOutByDiscordStreamHub
      ? {
          ok: true,
          status: 204,
          payload: { success: true, skipped: 'already-fanned-out-by-discord-stream-hub' },
        }
      : await forwardToStreamweaver(body).catch((error) => ({
          ok: false,
          status: 0,
          payload: { success: false, error: error?.message || 'Streamweaver forward failed' },
        }));

    let handled = false;
    if (controlComponents) {
      replies.push('Watch controls for the shared Activity session.');
      handled = true;
    }

    if (!handled) {
      handled = await handleWatchRequestCommand({
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
    }

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

    let streamweaverRelayName = 'Streamweaver';
    if (!handled) {
      const streamweaverResponse = streamweaverForward.payload?.response || streamweaverForward.payload?.data?.response;
      handled = Boolean(
        streamweaverForward.ok &&
        streamweaverForward.payload?.success !== false &&
        (streamweaverForward.payload?.handled || streamweaverForward.payload?.botResponded || streamweaverResponse)
      );
      if (handled && streamweaverResponse && !streamweaverForward.payload?.botResponded) {
        replies.push(String(streamweaverResponse));
        streamweaverRelayName = String(streamweaverForward.payload?.botName || streamweaverRelayName);
      }
    }

    const discordSends = handled
      ? await Promise.all(replies.map((reply) => sendDiscordMessage(
          channelId,
          reply,
          streamweaverForward.payload?.response ? streamweaverRelayName : 'HearMeOut',
          controlComponents || undefined
        )))
      : [];

    return NextResponse.json({
      success: true,
      handled,
      replies,
      reply: replies[0] || null,
      discordSends,
      streamweaverForward,
    });
  } catch (error) {
    console.error('[Discord Chat] watch command failed:', error);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
