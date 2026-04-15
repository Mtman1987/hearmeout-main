import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://hearmeout-main.fly.dev'}/api/twitch-bot/callback`;
  
  if (!clientId) {
    return NextResponse.json({ error: 'TWITCH_CLIENT_ID missing' }, { status: 500 });
  }

  const twitchAuthUrl = new URL('https://id.twitch.tv/oauth2/authorize');
  twitchAuthUrl.searchParams.set('client_id', clientId);
  twitchAuthUrl.searchParams.set('redirect_uri', redirectUri);
  twitchAuthUrl.searchParams.set('response_type', 'code');
  twitchAuthUrl.searchParams.set('scope', 'chat:read chat:edit');
  
  const url = twitchAuthUrl.toString();
  
  // Return HTML with client-side redirect to avoid CORS issues with RSC headers
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${url}"></head><body>Redirecting...</body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  );
}

