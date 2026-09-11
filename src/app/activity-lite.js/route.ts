import { NextResponse } from 'next/server';
import { DISCORD_CLIENT_ID } from '@/lib/public-config';
import { getDefaultActivitySessionId } from '@/lib/watch-request-service';
import { sharedPlayerScript } from '@/lib/shared-player-script';

export function js(clientId: string, sessionId: string, appBaseUrlOverride?: string) {
  return sharedPlayerScript(clientId, sessionId, appBaseUrlOverride || process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://hearmeout-main.fly.dev');
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  return new NextResponse(js(DISCORD_CLIENT_ID, getDefaultActivitySessionId(url.searchParams.get('sessionId'))), {
    headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' },
  });
}
