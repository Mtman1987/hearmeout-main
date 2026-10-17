import { NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';

export async function GET() {
  const apiKey = process.env.LIVEKIT_API_KEY?.trim() || '';
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim() || '';
  const browserUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL?.trim() || '';
  const serverUrl = process.env.LIVEKIT_URL?.trim() || '';
  const rawUrl = browserUrl || serverUrl;
  const isConfigured = Boolean(apiKey && apiSecret && browserUrl);

  // This unauthenticated endpoint reports only booleans and a coarse failure
  // category. Never return credentials, signed tokens, raw URLs, or room data.
  let roomServiceApi: 'ok' | 'credentials_rejected' | 'unreachable' | 'not_checked' = 'not_checked';
  let activeRooms: number | null = null;
  let activeParticipants: number | null = null;

  if (apiKey && apiSecret && rawUrl) {
    try {
      const host = rawUrl
        .replace(/^wss:/i, 'https:')
        .replace(/^ws:/i, 'http:')
        .replace(/\/$/, '');
      const client = new RoomServiceClient(host, apiKey, apiSecret);
      const rooms = await Promise.race([
        client.listRooms(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('probe timeout')), 5000)),
      ]);
      activeRooms = rooms.length;
      activeParticipants = rooms.reduce((sum, room) => sum + (Number(room.numParticipants) || 0), 0);
      roomServiceApi = 'ok';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = (error as { status?: number; statusCode?: number })?.status
        ?? (error as { statusCode?: number })?.statusCode;
      roomServiceApi = status === 401 || status === 403
        || /unauthori[sz]ed|invalid api key|invalid signature|permission denied/i.test(message)
        ? 'credentials_rejected'
        : 'unreachable';
    }
  }

  const ok = isConfigured && roomServiceApi === 'ok';

  return NextResponse.json(
    {
      ok,
      isConfigured,
      checks: {
        apiKeyPresent: Boolean(apiKey),
        apiSecretPresent: Boolean(apiSecret),
        urlPresent: Boolean(rawUrl),
        browserUrlPresent: Boolean(browserUrl),
        serverUrlPresent: Boolean(serverUrl),
        roomServiceApi,
        activeRooms,
        activeParticipants,
      },
    },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
