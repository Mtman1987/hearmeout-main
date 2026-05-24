import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { handleMusicCommand } from '@/lib/music-command-service';
import { handleWatchRequestCommand } from '@/lib/watch-request-service';
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

    let handledCommand = await handleWatchRequestCommand({
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
