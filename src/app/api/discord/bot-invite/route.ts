import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'Discord bot is not configured' }, { status: 503 });
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: 'Bot ' + token }, cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    const bot = await response.json();
    if (!response.ok || !bot.id) throw new Error('Unable to resolve the Discord bot. Retry shortly.');
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({ client_id: bot.id, integration_type: '0', scope: 'bot applications.commands', permissions: '8' }).toString();
    const redirect = NextResponse.redirect(url);
    redirect.headers.set('Cache-Control', 'no-store');
    return redirect;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invite unavailable' }, { status: 503 });
  }
}
