import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';

// Internal-only: hands the Discord bot token to the DJ worker so the voice
// bridge doesn't need its own copy of the secret. Guarded by the same
// worker marker the app already trusts for /api/livekit-token and /api/db.
// Never reachable from a browser session — only the internal worker call.
export async function GET(request: NextRequest) {
  if (!isDjWorkerRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const token = config.discordBotToken;
  if (!token) {
    return NextResponse.json({ error: 'DISCORD_BOT_TOKEN not configured' }, { status: 500 });
  }
  return NextResponse.json({ token });
}
