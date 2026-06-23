import { NextRequest, NextResponse } from 'next/server';
import { handleMusicCommand } from '@/lib/music-command-service';
import { GLOBAL_WATCH_SESSION_ID, normalizeWatchSessionAlias } from '@/lib/watch-session';
import {
  buildWatchJoinMessage,
  getActivityUrl,
  getResolvedWatchSession,
  handleWatchRequestCommand,
  watchControlComponents,
} from '@/lib/watch/watch-request-service';

type DiscordMessagePayload = {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
  allowed_mentions?: unknown;
};

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

function buildDiscordMessageBody(reply: string | DiscordMessagePayload, username?: string, components?: any[]) {
  if (typeof reply === 'string') {
    return { content: reply, username, components };
  }

  return {
    content: reply.content || '',
    embeds: reply.embeds,
    components: components || reply.components,
    allowed_mentions: reply.allowed_mentions,
    username,
  };
}

async function sendDiscordMessageDirect(channelId: string, reply: string | DiscordMessagePayload, botToken: string, components?: any[]) {
  const body = buildDiscordMessageBody(reply, undefined, components);
  delete body.username;
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: timeoutSignal(7_000),
  });
  if (res.ok) return { ok: true, via: 'bot-message' };
  return { ok: false, error: `Bot message send failed (${res.status})` };
}

async function sendDiscordMessage(channelId: string, reply: string | DiscordMessagePayload, username?: string, components?: any[], isDM?: boolean) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return { ok: false, error: 'DISCORD_BOT_TOKEN is not configured' };

  // DMs don't support webhooks — send directly via Bot API
  if (isDM) {
    try {
      return await sendDiscordMessageDirect(channelId, reply, botToken, components);
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
          body: JSON.stringify(buildDiscordMessageBody(reply, username || 'HearMeOut', components)),
          signal: timeoutSignal(7_000),
        });
        if (sendRes.ok) return { ok: true, via: 'webhook' };
      }
    }

    // Fallback to direct Bot API if webhook fails (e.g. permissions issue)
    return sendDiscordMessageDirect(channelId, reply, botToken, components);
  } catch (error: any) {
    // Last-resort fallback to direct message on network/timeout errors
    try {
      return await sendDiscordMessageDirect(channelId, reply, botToken, components);
    } catch {
      return { ok: false, error: error?.message || 'Discord send failed' };
    }
  }
}


function parseJsonText(raw: string) {
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function parseNestedJsonValue(value: unknown) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  return JSON.parse(trimmed);
}

function unwrapDiscordChatRoot(body: any): any {
  let current = parseNestedJsonValue(body);
  const seen = new Set<unknown>();

  while (current && typeof current === 'object' && 'root' in current && !seen.has(current)) {
    seen.add(current);
    current = parseNestedJsonValue((current as { root?: unknown }).root);
  }

  return current && typeof current === 'object' ? current : {};
}

async function parseDiscordChatRequest(request: NextRequest) {
  const raw = await request.text();
  if (!raw.trim()) return {};

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    const payloadJson = params.get('payload_json');
    if (payloadJson) return parseJsonText(payloadJson);

    const rootJson = params.get('root');
    if (rootJson) return { root: parseNestedJsonValue(rootJson) };

    return Object.fromEntries(params.entries());
  }

  try {
    return parseJsonText(raw);
  } catch (initialError) {
    const sanitized = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    if (sanitized !== raw) return parseJsonText(sanitized);
    throw initialError;
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

function isDirectDiscordMessage(data: any) {
  const explicit = data.isDM ?? data.isDirectMessage ?? data.is_direct_message ?? data.dm;
  if (explicit !== undefined) return Boolean(explicit);

  const channelType = String(data.channelType ?? data.channel_type ?? data.channel?.type ?? '').toLowerCase();
  return channelType === 'dm' || channelType === '1';
}

function parseWatchControlsCommand(message: string) {
  const match = message.trim().match(/^!(controls?|watch-controls)(?:\s+(.+))?$/i);
  if (!match) return null;
  return {
    sessionId: normalizeWatchSessionAlias(match[2], GLOBAL_WATCH_SESSION_ID),
  };
}

function buildWatchControlsReply(publicBaseUrl: string, sessionId = GLOBAL_WATCH_SESSION_ID): DiscordMessagePayload {
  const joinUrl = getActivityUrl(publicBaseUrl, sessionId);
  const session = getResolvedWatchSession(sessionId);

  if (session.current) {
    const status = session.playback.status === 'playing'
      ? 'now playing'
      : session.playback.status === 'paused'
        ? 'paused'
        : 'ready';
    return buildWatchJoinMessage(session.current.item.title, status, joinUrl, session.current.item);
  }

  return {
    content: `Watch Party controls for ${sessionId}: ${joinUrl}`,
    components: watchControlComponents(joinUrl),
    allowed_mentions: { parse: [] },
  };
}

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await parseDiscordChatRequest(request);
    } catch (error) {
      console.error('[Discord Chat] invalid JSON payload:', error);
      return NextResponse.json({
        success: false,
        error: 'Invalid JSON payload. Send valid JSON with Content-Type: application/json and build the body with JSON.stringify.',
      }, { status: 400 });
    }
    const data = unwrapDiscordChatRoot(body);
    const message = String(data.message || data.content || '').trim();
    const channelId = String(data.channelId || '').trim();
    const guildId = String(data.guildId || data.serverId || 'local').trim();
    const userId = String(data.userId || data.authorId || 'discord').trim();
    const userName = String(data.userName || data.displayName || data.username || 'Discord User').trim();
    const isDM = isDirectDiscordMessage(data);
    const replies: Array<string | DiscordMessagePayload> = [];
    const watchControlsCommand = parseWatchControlsCommand(message);

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

    let handled = false;
    if (watchControlsCommand) {
      replies.push(buildWatchControlsReply(getRequestBaseUrl(request), watchControlsCommand.sessionId));
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
        richReply: (content) => {
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
        guildId,
        channelId,
        publicBaseUrl: getRequestBaseUrl(request),
        reply: (content) => {
          replies.push(content);
        },
      });
    }

    const discordSends = handled
      ? await Promise.all(replies.map((reply) => sendDiscordMessage(
          channelId,
          reply,
          'HearMeOut',
          typeof reply === 'string' ? undefined : reply.components,
          isDM
        )))
      : [];

    return NextResponse.json({
      success: true,
      handled,
      replies,
      reply: replies[0] || null,
      discordSends,
    });
  } catch (error) {
    console.error('[Discord Chat] watch command failed:', error);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
