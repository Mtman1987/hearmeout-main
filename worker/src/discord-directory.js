'use strict';

const API = 'https://discord.com/api/v10';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRY_MS = 5_000;

function token() {
  const value = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!value) throw new Error('DISCORD_BOT_TOKEN is not configured on the worker');
  return value;
}

function snowflake(value, name = 'Discord id') {
  const clean = String(value || '').trim();
  if (!/^\d{5,30}$/.test(clean)) throw new Error(`${name} is invalid`);
  return clean;
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function request(path, retry = true) {
  const response = await fetch(`${API}${path}`, {
    headers: { authorization: `Bot ${token()}`, accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 429 && retry) {
    const body = await response.json().catch(() => ({}));
    const retryMs = Math.max(100, Math.min(MAX_RETRY_MS, Math.ceil(Number(body.retry_after || 1) * 1000)));
    await delay(retryMs);
    return request(path, false);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Discord directory request failed (${response.status})`);
  }
  return response.json();
}

async function listDiscordGuilds() {
  const values = await request('/users/@me/guilds');
  return (Array.isArray(values) ? values : [])
    .filter(value => /^\d{5,30}$/.test(String(value?.id || '')) && typeof value?.name === 'string')
    .map(value => ({
      id: String(value.id),
      name: String(value.name).slice(0, 120),
      ...(typeof value.icon === 'string' && value.icon ? { icon: value.icon.slice(0, 200) } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listDiscordVoiceChannels(guildIdValue) {
  const guildId = snowflake(guildIdValue, 'Discord guild id');
  const values = await request(`/guilds/${guildId}/channels`);
  return (Array.isArray(values) ? values : [])
    .filter(value => [2, 13].includes(Number(value?.type)) && /^\d{5,30}$/.test(String(value?.id || '')) && typeof value?.name === 'string')
    .map(value => ({
      id: String(value.id),
      name: String(value.name).slice(0, 120),
      type: Number(value.type),
      position: Number.isFinite(Number(value.position)) ? Number(value.position) : 0,
      ...(value.parent_id ? { parentId: String(value.parent_id) } : {}),
    }))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

module.exports = { listDiscordGuilds, listDiscordVoiceChannels };
