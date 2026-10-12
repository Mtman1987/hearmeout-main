import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

const API = 'https://discord.com/api/v10';
const SNOWFLAKE = /^\d{5,30}$/;
const checks = new Map<string, { until: number; value: Promise<{ present: boolean; inviteUrl?: string }> }>();
let botIdentity: { token: string; value: Promise<string> } | undefined;

async function discord(path: string, token: string) {
  return fetch(API + path, {
    headers: { Authorization: 'Bot ' + token, Accept: 'application/json' },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
  });
}

function botId(token: string) {
  if (!botIdentity || botIdentity.token !== token) {
    const value = discord('/users/@me', token).then(async response => {
      if (!response.ok) throw new Error('Bot identity unavailable');
      const user = await response.json();
      if (!user.bot || !SNOWFLAKE.test(String(user.id))) throw new Error('Invalid bot identity');
      return String(user.id);
    });
    botIdentity = { token, value };
    value.catch(() => { if (botIdentity?.value === value) botIdentity = undefined; });
  }
  return botIdentity.value;
}

async function checkGuild(guildId: string, token: string) {
  const response = await discord('/guilds/' + guildId, token);
  if (response.ok) {
    await response.body?.cancel();
    return { present: true };
  }
  const error = await response.json().catch(() => ({}));
  // Missing Access / Unknown Guild mean this bot cannot access the server.
  // Outages, token errors, and rate limits must never look like a missing bot.
  if (!([403, 404].includes(response.status) && [50001, 10004].includes(error.code))) {
    throw new Error('Bot membership check unavailable');
  }
  const id = await botId(token);
  const invite = new URL('https://discord.com/oauth2/authorize');
  invite.searchParams.set('client_id', id);
  invite.searchParams.set('scope', 'bot applications.commands');
  // Administrator covers the shared SPMT ecosystem's server features.
  invite.searchParams.set('permissions', '8');
  invite.searchParams.set('integration_type', '0');
  invite.searchParams.set('guild_id', guildId);
  invite.searchParams.set('disable_guild_select', 'true');
  return { present: false, inviteUrl: invite.toString() };
}

// Public, read-only Activity setup. Never returns server names, channels,
// credentials, or bridge controls; website cookies are unavailable in Discord.
export async function GET(request: Request) {
  const guildId = new URL(request.url).searchParams.get('guildId') || '';
  const headers = { 'Cache-Control': 'no-store' };
  if (!SNOWFLAKE.test(guildId)) return NextResponse.json({ error: 'Invalid server ID' }, { status: 400, headers });
  const token = config.discordBotToken;
  if (!token) return NextResponse.json({ error: 'Bot setup unavailable' }, { status: 503, headers });
  let entry = checks.get(guildId);
  if (!entry || entry.until <= Date.now()) {
    if (checks.size >= 200) checks.delete(checks.keys().next().value!);
    const value = checkGuild(guildId, token);
    entry = { until: Date.now() + 15000, value };
    checks.set(guildId, entry);
    value.catch(() => { if (checks.get(guildId)?.value === value) checks.delete(guildId); });
  }
  try {
    return NextResponse.json(await entry.value, { headers });
  } catch {
    return NextResponse.json({ error: 'Bot setup check temporarily unavailable' }, { status: 503, headers });
  }
}
