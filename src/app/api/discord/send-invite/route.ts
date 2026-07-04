import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { config } from '@/lib/config';
import { publishSpmtEvent } from '@/lib/spmt-client';

// Audit S5: previously this route accepted any roomUrl and DM'd it from the
// HearMeOut bot to any Discord user, turning the bot into a spam/phishing
// primitive. Now requires auth AND only allows links pointing back to our
// own deployment.
function isAllowedRoomUrl(input: string): boolean {
  try {
    const u = new URL(input);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const allowedHosts = new Set<string>();
    try {
      allowedHosts.add(new URL(config.baseUrl).host);
    } catch { /* ignore */ }
    // Tolerate the canonical deploy host even if config.baseUrl is unset.
    allowedHosts.add('hearmeout-main.fly.dev');
    return allowedHosts.has(u.host);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId, roomUrl, expiresAt } = await req.json();

  if (!userId || !roomUrl) {
    return NextResponse.json({ error: 'Missing userId or roomUrl' }, { status: 400 });
  }

  if (typeof roomUrl !== 'string' || !isAllowedRoomUrl(roomUrl)) {
    return NextResponse.json(
      { error: 'roomUrl must point to the HearMeOut deployment' },
      { status: 400 },
    );
  }

  if (typeof userId !== 'string' || !/^[0-9]{5,32}$/.test(userId)) {
    return NextResponse.json({ error: 'Invalid Discord user id' }, { status: 400 });
  }

  const DISCORD_BOT_TOKEN = config.discordBotToken;
  if (!DISCORD_BOT_TOKEN) {
    return NextResponse.json({ error: 'Bot not configured' }, { status: 500 });
  }

  try {
    // Create DM channel
    const dmChannelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({ recipient_id: userId }),
    });

    if (!dmChannelRes.ok) {
      throw new Error('Failed to create DM channel');
    }

    const dmChannel = await dmChannelRes.json();

    // Send message
    const expiresLine = typeof expiresAt === 'string' && expiresAt.length < 200
      ? `\n\n⏰ This link expires at: ${expiresAt}`
      : '';
    const messageRes = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        content: `🎤 **It's your turn to join the voice chat!**\n\n${roomUrl}${expiresLine}\n\nJoin now and have fun!`,
      }),
    });

    if (!messageRes.ok) {
      throw new Error('Failed to send DM');
    }

    await publishSpmtEvent({
      type: 'voice.room.invite_sent',
      actor: {
        userId: session.uid,
        username: session.user?.email || session.user?.username || undefined,
        displayName: session.user?.displayName || session.user?.name || undefined,
      },
      payload: {
        invitedDiscordUserId: userId,
        roomUrl,
        expiresAt: typeof expiresAt === 'string' ? expiresAt : null,
        delivery: 'discord_dm',
      },
      links: [
        {
          label: 'Open room',
          url: roomUrl,
          kind: 'launch',
        },
      ],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending Discord DM:', error);
    return NextResponse.json({ error: 'Failed to send DM' }, { status: 500 });
  }
}
