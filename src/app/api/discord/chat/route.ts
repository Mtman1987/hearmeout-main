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
    const body = await request.json();
    const data = body.root || body;
    const message = String(data.message || data.content || '').trim();
    const channelId = String(data.channelId || '').trim();
    const guildId = String(data.guildId || 'local').trim();
    const userId = String(data.userId || data.authorId || 'discord').trim();
    const userName = String(data.userName || data.displayName || data.username || 'Discord User').trim();

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
    });

    return NextResponse.json({ success: true, handled });
  } catch (error) {
    console.error('[Discord Chat] watch command failed:', error);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
