import { NextRequest, NextResponse } from 'next/server';
import { handleWatchRequestCommand } from '@/lib/watch/watch-request-service';

function getRequestBaseUrl(request: NextRequest) {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const proto = forwardedProto || request.nextUrl.protocol.replace(':', '');
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host;
  return `${proto}://${host}`;
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

    const handled = await handleWatchRequestCommand({
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

    return NextResponse.json({ success: true, handled, replies, reply: replies[0] || null });
  } catch (error) {
    console.error('[Discord Chat] watch command failed:', error);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
