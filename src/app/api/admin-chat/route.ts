import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { handleMusicCommand } from '@/lib/music-command-service';
import { controlWatchSession, handleWatchRequestCommand } from '@/lib/watch-request-service';
import { GLOBAL_WATCH_SESSION_ID, MUSIC_WATCH_SESSION_ID } from '@/lib/watch-session';
import { DSH_URL, HARDCODED_GUILD_ID } from '@/lib/constants';

const DB_API_KEY = process.env.DB_API_KEY || '';

function getChatPath(serverId?: string | null) {
  const resolved = serverId || process.env.HARDCODED_GUILD_ID || HARDCODED_GUILD_ID;
  if (!resolved) return null;
  return `servers/${resolved}/config/adminChat`;
}

function getRequestBaseUrl(request: NextRequest) {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const proto = forwardedProto || request.nextUrl.protocol.replace(':', '');
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host;
  return `${proto}://${host}`;
}

function parseAdminControlCommand(message: string) {
  const trimmed = String(message || '').trim();
  if (/^!(controls?|watch-controls)$/i.test(trimmed)) {
    return { action: 'help' as const, target: 'all' as const };
  }

  const clearMatch = trimmed.match(/^!(?:clear|reset)(?:\s+(movie|movies|music|song|songs|all))?$/i);
  if (clearMatch) {
    const rawTarget = String(clearMatch[1] || 'all').toLowerCase();
    return {
      action: 'clear' as const,
      target: rawTarget.startsWith('music') || rawTarget.startsWith('song') ? 'music' as const : rawTarget === 'all' ? 'all' as const : 'movie' as const,
    };
  }

  const laneActionMatch = trimmed.match(/^!(movie|movies|music|song|songs)\s+(play|pause|next|clear|mute|unmute)$/i);
  if (laneActionMatch) {
    const lane = String(laneActionMatch[1]).toLowerCase();
    return {
      action: String(laneActionMatch[2]).toLowerCase() as 'play' | 'pause' | 'next' | 'clear' | 'mute' | 'unmute',
      target: lane.startsWith('music') || lane.startsWith('song') ? 'music' as const : 'movie' as const,
    };
  }

  return null;
}

// eslint-disable-next-line no-unused-vars
async function handleAdminControlCommand(message: string, reply: (text: string) => void) {
  const command = parseAdminControlCommand(message);
  if (!command) return false;

  if (command.action === 'help') {
    reply('Controls: `!clear all`, `!clear movie`, `!clear music`, `!movie play|pause|next|clear|mute|unmute`, `!music play|pause|next|clear|mute|unmute`.');
    return true;
  }

  const targets = command.target === 'all'
    ? [
        { label: 'movie', sessionId: GLOBAL_WATCH_SESSION_ID },
        { label: 'music', sessionId: MUSIC_WATCH_SESSION_ID },
      ]
    : [{ label: command.target, sessionId: command.target === 'music' ? MUSIC_WATCH_SESSION_ID : GLOBAL_WATCH_SESSION_ID }];

  const results: string[] = [];
  for (const target of targets) {
    const session = await controlWatchSession(target.sessionId, command.action, 0, undefined, {
      isAdmin: true,
      platform: 'admin',
    });
    results.push(`${target.label}: ${command.action === 'clear' ? 'cleared' : session.playback.status}${session.current?.item?.title ? ` (${session.current.item.title})` : ''}`);
  }
  reply(results.join(' | '));
  return true;
}

export async function GET(req: NextRequest) {
  const chatPath = getChatPath(new URL(req.url).searchParams.get('serverId'));
  if (!chatPath) return NextResponse.json({ messages: [] });
  try {
    const res = await fetch(`${DSH_URL}/api/db?path=${chatPath}`);
    if (!res.ok) return NextResponse.json({ messages: [] });
    const data = await res.json();
    return NextResponse.json({ messages: data.data?.messages || [] });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const chatPath = getChatPath(new URL(req.url).searchParams.get('serverId'));
  if (!chatPath) return NextResponse.json({ error: 'Missing serverId' }, { status: 400 });

  try {
    const { message } = await req.json();
    if (!message?.text) return NextResponse.json({ error: 'Missing message' }, { status: 400 });
    const serverId = new URL(req.url).searchParams.get('serverId') || process.env.HARDCODED_GUILD_ID || HARDCODED_GUILD_ID || 'local';
    const commandReplies: any[] = [];
    const addCommandReply = (text: string) => {
      commandReplies.push({
        id: `${Date.now()}_bot_${Math.random().toString(36).slice(2, 6)}`,
        username: 'HearMeOut Bot',
        text,
        timestamp: new Date().toISOString(),
      });
    };

    let handledCommand = await handleAdminControlCommand(message.text, addCommandReply);

    if (!handledCommand) handledCommand = await handleWatchRequestCommand({
      message: message.text,
      discordUserId: session.uid,
      discordUserName: message.username || session.user?.displayName || 'Admin',
      guildId: serverId,
      channelId: process.env.DISCORD_CHANNEL_ID || 'admin-chat',
      publicBaseUrl: getRequestBaseUrl(req),
      reply: addCommandReply,
    });

    if (!handledCommand) {
      handledCommand = await handleMusicCommand({
        message: message.text,
        userId: session.uid,
        username: message.username || session.user?.displayName || 'Admin',
        platform: 'admin',
        guildId: serverId,
        channelId: process.env.DISCORD_CHANNEL_ID || 'admin-chat',
        publicBaseUrl: getRequestBaseUrl(req),
        reply: addCommandReply,
      });
    }

    // Fetch current messages
    const getRes = await fetch(`${DSH_URL}/api/db?path=${chatPath}`);
    const existing = getRes.ok ? await getRes.json() : { data: { messages: [] } };
    const messages = [...(existing.data?.messages || []), message, ...commandReplies].slice(-50);

    // Write back via DSH with API key
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (DB_API_KEY) headers['x-api-key'] = DB_API_KEY;

    const writeRes = await fetch(`${DSH_URL}/api/db`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: chatPath, data: { messages }, merge: true }),
    });

    if (!writeRes.ok) {
      const err = await writeRes.text();
      console.error('[AdminChat] Write failed:', err);
      return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
    }

    return NextResponse.json({ success: true, handledCommand, replies: commandReplies });
  } catch (error) {
    console.error('[AdminChat] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
