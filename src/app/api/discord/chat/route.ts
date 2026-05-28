import { NextRequest, NextResponse } from 'next/server';
import { handleMusicCommand } from '@/lib/music-command-service';
import { handleWatchRequestCommand } from '@/lib/watch/watch-request-service';

const processedDiscordMessages = new Map<string, number>();
const PROCESSED_MESSAGE_TTL_MS = 10 * 60 * 1000;

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

async function sendDiscordMessageDirect(channelId: string, content: string, botToken: string) {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    signal: timeoutSignal(7_000),
  });
  if (res.ok) return { ok: true, via: 'bot-message' };
  return { ok: false, error: `Bot message send failed (${res.status})` };
}

async function sendDiscordMessage(channelId: string, content: string, username?: string, components?: any[], isDM?: boolean) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return { ok: false, error: 'DISCORD_BOT_TOKEN is not configured' };

  // DMs don't support webhooks — send directly via Bot API
  if (isDM) {
    try {
      return await sendDiscordMessageDirect(channelId, content, botToken);
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Discord DM send failed' };
    }
  }

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

    // Fallback to direct Bot API if webhook fails (e.g. permissions issue)
    return sendDiscordMessageDirect(channelId, content, botToken);
  } catch (error: any) {
    // Last-resort fallback to direct message on network/timeout errors
    try {
      return await sendDiscordMessageDirect(channelId, content, botToken);
    } catch {
      return { ok: false, error: error?.message || 'Discord send failed' };
    }
  }
}

function markDiscordMessageSeen(guildId: string, channelId: string, messageId: string) {
  if (!messageId || !channelId) return false;

  const now = Date.now();
  for (const [key, seenAt] of processedDiscordMessages) {
    if (now - seenAt > PROCESSED_MESSAGE_TTL_MS) {
      processedDiscordMessages.delete(key);
    }
  }

  const key = `${guildId}:${channelId}:${messageId}`;
  if (processedDiscordMessages.has(key)) return true;
  processedDiscordMessages.set(key, now);
  return false;
}

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      const raw = await request.text();
      body = JSON.parse(raw.replace(/[\x00-\x1F\x7F]/g, ''));
    } catch (error) {
      console.error('[Discord Chat] invalid JSON payload:', error);
      return NextResponse.json({ success: false, error: 'Invalid JSON payload' }, { status: 400 });
    }
    const data = body.root || body;
    const message = String(data.message || data.content || '').trim();
    const channelId = String(data.channelId || '').trim();
    const guildId = String(data.guildId || data.serverId || 'local').trim();
    const userId = String(data.userId || data.authorId || 'discord').trim();
    const userName = String(data.userName || data.displayName || data.username || 'Discord User').trim();
    const isDM = !data.guildId && !data.serverId;
    const replies: string[] = [];
    const isWatchControlCommand = /^!(controls?|watch-controls)$/i.test(message);

    if (!message) {
      return NextResponse.json({ success: true, handled: false, skipped: 'empty message' });
    }

    if (!channelId) {
      return NextResponse.json({ success: false, error: 'Missing channelId' }, { status: 400 });
    }

    const messageId = String(data.messageId || data.id || '').trim();
    if (markDiscordMessageSeen(guildId, channelId, messageId)) {
      console.log(`[Discord Chat] Duplicate message ignored: ${guildId}/${channelId}/${messageId}`);
      return NextResponse.json({ success: true, handled: true, skipped: 'duplicate-message', replies: [] });
    }

    const alreadyFannedOutByDiscordStreamHub = request.headers.get('x-chat-origin') === 'dsh-fanout';
    let streamweaverForward = {
      ok: true,
      status: 204,
      payload: { success: true, skipped: 'not-needed' } as any,
    };

    let handled = false;
    if (isWatchControlCommand) {
      // DSH owns Discord component interactions, so it posts the live control buttons.
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
      streamweaverForward = alreadyFannedOutByDiscordStreamHub
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
          undefined,
          isDM
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
