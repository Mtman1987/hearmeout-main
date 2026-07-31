import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { config } from '@/lib/config';

export type HearMeOutDiscordPayload = {
  content?: string;
  embeds?: Record<string, any>[];
  components?: Record<string, any>[];
  allowed_mentions?: Record<string, any>;
  flags?: number;
};

export type HearMeOutDiscordContext = {
  responseType?: string;
  sourceUser?: string;
  sourceMessage?: string;
  sourceUserAvatarUrl?: string;
  sourceMessageId?: string;
  cleanupAfterMs?: number;
  isDirectMessage?: boolean;
};

type CleanupEntry = {
  id: string;
  channelId: string;
  messageIds: string[];
  deleteAt: string;
};

const DEFAULT_CLEANUP_MS = 10 * 60 * 1000;
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
let cleanupProcessing = false;
let botAvatarCache: { url: string; expiresAt: number } | null = null;

function dataDir(): string {
  return process.env.FLY_APP_NAME ? '/data' : join(process.cwd(), 'data');
}

function cleanupFile(): string {
  return join(dataDir(), 'discord-reply-cleanup.json');
}

function appLogoUrl(): string {
  return `${config.baseUrl.replace(/\/$/, '')}/brand/hearmeout-icon-512.png`;
}

function firstUrl(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (/^https?:\/\//i.test(normalized)) return normalized;
  }
  return '';
}

function truncate(value: unknown, limit: number): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function inferResponseType(message?: string): string {
  const command = String(message || '').trim().match(/^!([^\s]+)/)?.[1]?.toLowerCase();
  if (!command) return 'Response';
  if (['wr', 'watch', 'watchrequest'].includes(command)) return 'Watch Request';
  if (['controls', 'control', 'watch-controls'].includes(command)) return 'Watch Controls';
  if (['music', 'song', 'play', 'skip', 'queue'].includes(command)) return 'Music Request';
  if (command === 'invite') return 'Voice Invitation';
  return 'Command Response';
}

async function getBotAvatarUrl(): Promise<string> {
  if (botAvatarCache && botAvatarCache.expiresAt > Date.now()) return botAvatarCache.url;
  if (!config.discordBotToken) return appLogoUrl();
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${config.discordBotToken}` },
      cache: 'no-store',
    });
    const user = response.ok ? await response.json() : null;
    if (user?.id && user?.avatar) {
      const extension = String(user.avatar).startsWith('a_') ? 'gif' : 'png';
      const url = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=256`;
      botAvatarCache = { url, expiresAt: Date.now() + 60 * 60 * 1000 };
      return url;
    }
  } catch {}
  return appLogoUrl();
}

export async function buildHearMeOutDiscordPayload(
  raw: string | HearMeOutDiscordPayload,
  context: HearMeOutDiscordContext = {},
): Promise<HearMeOutDiscordPayload> {
  const payload = typeof raw === 'string' ? { content: raw } : raw;
  const existing = payload.embeds?.[0] || {};
  const responseType = context.responseType || inferResponseType(context.sourceMessage);
  const deleteAt = context.cleanupAfterMs
    ? new Date(Date.now() + context.cleanupAfterMs).toISOString()
    : '';
  const footerParts = [
    context.sourceUser ? `Requested by ${truncate(context.sourceUser, 80)}` : 'HearMeOut',
    context.sourceMessage ? truncate(context.sourceMessage, 240) : '',
    deleteAt ? `deletes in ${Math.max(1, Math.ceil(context.cleanupAfterMs! / 60_000))}m` : '',
  ].filter(Boolean);
  const fields = Array.isArray(existing.fields) ? [...existing.fields] : [];
  if (existing.title && existing.title !== `HearMeOut • ${responseType}`) {
    fields.unshift({ name: 'Media', value: truncate(existing.title, 1024), inline: false });
  }
  const description = [
    payload.content,
    existing.description,
  ].map((value) => String(value || '').trim()).filter(Boolean).join('\n\n') || 'HearMeOut updated this Discord session.';
  const posterUrl = firstUrl(existing.image?.url, existing.thumbnail?.url);

  return {
    content: '',
    embeds: [{
      ...existing,
      title: `HearMeOut • ${responseType}`,
      description,
      fields: fields.length ? fields : undefined,
      author: {
        name: 'HearMeOut',
        icon_url: appLogoUrl(),
        url: config.baseUrl,
      },
      thumbnail: { url: await getBotAvatarUrl() },
      image: posterUrl ? { url: posterUrl } : undefined,
      footer: {
        text: footerParts.join(' • '),
        icon_url: firstUrl(context.sourceUserAvatarUrl) || appLogoUrl(),
      },
      timestamp: new Date().toISOString(),
      color: existing.color || 0x8b5cf6,
    }],
    components: payload.components,
    allowed_mentions: payload.allowed_mentions || { parse: [] },
    flags: payload.flags,
  };
}

async function discordDelete(channelId: string, messageId: string): Promise<boolean> {
  if (!config.discordBotToken || !channelId || !messageId) return false;
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${config.discordBotToken}` },
  }).catch(() => null);
  return Boolean(response?.ok || response?.status === 404);
}

async function readCleanupQueue(): Promise<CleanupEntry[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(cleanupFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeCleanupQueue(queue: CleanupEntry[]): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(cleanupFile(), JSON.stringify(queue.slice(-250), null, 2));
}

function scheduleCleanup(entry: CleanupEntry): void {
  const existing = cleanupTimers.get(entry.id);
  if (existing) clearTimeout(existing);
  cleanupTimers.set(entry.id, setTimeout(() => {
    cleanupTimers.delete(entry.id);
    processDueHearMeOutDiscordCleanups().catch((error) => {
      console.warn('[HearMeOut Discord] Cleanup sweep failed:', error);
    });
  }, Math.max(0, Date.parse(entry.deleteAt) - Date.now())));
}

async function recordCleanup(channelId: string, messageIds: string[], cleanupAfterMs: number): Promise<void> {
  const uniqueIds = Array.from(new Set(messageIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (!channelId || uniqueIds.length === 0) return;
  const entry: CleanupEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    channelId,
    messageIds: uniqueIds,
    deleteAt: new Date(Date.now() + cleanupAfterMs).toISOString(),
  };
  await writeCleanupQueue([...(await readCleanupQueue()), entry]);
  scheduleCleanup(entry);
}

export async function processDueHearMeOutDiscordCleanups(): Promise<void> {
  if (cleanupProcessing) return;
  cleanupProcessing = true;
  try {
    const queue = await readCleanupQueue();
    const now = Date.now();
    const due = queue.filter((entry) => Date.parse(entry.deleteAt) <= now);
    const pending = queue.filter((entry) => Date.parse(entry.deleteAt) > now);
    for (const entry of due) {
      const failed: string[] = [];
      for (const messageId of entry.messageIds) {
        if (!await discordDelete(entry.channelId, messageId)) failed.push(messageId);
      }
      if (failed.length) {
        pending.push({ ...entry, messageIds: failed, deleteAt: new Date(Date.now() + 60_000).toISOString() });
      }
    }
    await writeCleanupQueue(pending);
    pending.forEach(scheduleCleanup);
  } finally {
    cleanupProcessing = false;
  }
}

async function getOrCreateWebhook(channelId: string): Promise<{ id: string; token: string } | null> {
  if (!config.discordBotToken) return null;
  const headers = { Authorization: `Bot ${config.discordBotToken}` };
  const existingResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, { headers });
  if (existingResponse.ok) {
    const webhooks = await existingResponse.json();
    const existing = Array.isArray(webhooks) ? webhooks.find((entry: any) => entry.name === 'HearMeOut') : null;
    if (existing?.id && existing?.token) return existing;
  }
  const createResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'HearMeOut' }),
  });
  if (!createResponse.ok) return null;
  return createResponse.json();
}

export async function sendHearMeOutDiscordMessage(
  channelId: string,
  raw: string | HearMeOutDiscordPayload,
  context: HearMeOutDiscordContext = {},
): Promise<{ ok: boolean; messageId?: string; via?: 'webhook' | 'bot'; error?: string }> {
  if (!config.discordBotToken) return { ok: false, error: 'DISCORD_BOT_TOKEN is not configured' };
  processDueHearMeOutDiscordCleanups().catch(() => {});
  const cleanupAfterMs = context.cleanupAfterMs ?? (context.sourceMessageId ? DEFAULT_CLEANUP_MS : 0);
  const payload = await buildHearMeOutDiscordPayload(raw, { ...context, cleanupAfterMs });
  const useBot = Boolean(context.isDirectMessage || payload.components?.length);

  let response: Response | null = null;
  let via: 'webhook' | 'bot' = 'bot';
  if (!useBot) {
    const webhook = await getOrCreateWebhook(channelId).catch(() => null);
    if (webhook) {
      const separator = webhook.token.includes('?') ? '&' : '?';
      response = await fetch(`https://discord.com/api/v10/webhooks/${webhook.id}/${webhook.token}${separator}wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, username: 'HearMeOut', avatar_url: appLogoUrl() }),
      }).catch(() => null);
      via = 'webhook';
    }
  }
  if (!response?.ok) {
    response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${config.discordBotToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    via = 'bot';
  }
  if (!response?.ok) return { ok: false, error: `Discord send failed (${response?.status || 0})` };

  const sent = await response.json().catch(() => null);
  const messageId = String(sent?.id || '').trim() || undefined;
  if (messageId && context.sourceMessageId) {
    await discordDelete(channelId, context.sourceMessageId).catch(() => false);
  }
  if (messageId && cleanupAfterMs > 0) {
    await recordCleanup(channelId, [context.sourceMessageId || '', messageId], cleanupAfterMs).catch(() => {});
  }
  return { ok: true, messageId, via };
}
