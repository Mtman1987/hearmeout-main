import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';

export async function POST(request: NextRequest) {
  try {
    const { roomId, userId, userName, musicRoom, isDJ } = await request.json();

    if (!roomId || !userId || !userName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: 'LiveKit credentials not configured' }, { status: 500 });
    }

    let actualRoom = roomId;
    let identity = userId;

    if (musicRoom) {
      actualRoom = `${roomId}-music`;
      identity = isDJ ? 'HearMeOutDJ' : `listener-${userId}`;
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: isDJ ? 'HearMeOut DJ' : userName,
    });

    // Music room: only the headless DJ may publish (everyone else listens).
    // Voice room: every participant may publish their mic + screen share;
    // setting canPublish:false here broke both mic and screen-share for
    // listeners. canPublishData stays on so chat/data messages still work.
    at.addGrant({
      roomJoin: true,
      room: actualRoom,
      canPublish: musicRoom ? !!isDJ : true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return NextResponse.json({ token });
  } catch (error) {
    console.error('Error generating LiveKit token:', error);
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 });
  }
}
