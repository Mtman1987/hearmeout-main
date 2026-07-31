import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sendHearMeOutDiscordMessage } from '@/lib/discord-messaging';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { channelId, content, username, avatarUrl } = await req.json();

    if (!channelId || !content) {
      return NextResponse.json({ error: 'Missing channelId or content' }, { status: 400 });
    }

    const result = await sendHearMeOutDiscordMessage(channelId, content, {
      responseType: 'Shared Message',
      sourceUser: username || session.user?.displayName || session.user?.username || session.user?.email || 'HearMeOut User',
      sourceMessage: content,
      sourceUserAvatarUrl: avatarUrl || session.user?.photoURL || '',
    });
    if (!result.ok) {
      return NextResponse.json({ error: 'Failed to send message', details: result.error }, { status: 502 });
    }
    return NextResponse.json({ success: true, messageId: result.messageId, via: result.via });
  } catch (error) {
    console.error('Error sending Discord message:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
