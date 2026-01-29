import { NextRequest, NextResponse } from 'next/server';
import { sendControlEmbed } from '@/bots/discord-bot';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { channelId, roomId, roomName, description, link1Label, link1Url, link2Label, link2Url } = body;

    if (!channelId) {
      return NextResponse.json({ error: 'Channel ID required' }, { status: 400 });
    }

    await sendControlEmbed(
      channelId,
      roomId,
      roomName,
      description,
      link1Label,
      link1Url,
      link2Label,
      link2Url
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Post embed error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
