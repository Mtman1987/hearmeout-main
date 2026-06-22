export const GLOBAL_WATCH_SESSION_ID = 'discord-watch-room';

export function getGlobalWatchSessionId() {
  return GLOBAL_WATCH_SESSION_ID;
}

function cleanScopePart(value: string) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

export function getScopedWatchSessionId(guildId?: string | null, channelId?: string | null) {
  const cleanGuildId = cleanScopePart(guildId || '');
  const cleanChannelId = cleanScopePart(channelId || '');
  if (!cleanGuildId || !cleanChannelId || cleanGuildId === 'local') return GLOBAL_WATCH_SESSION_ID;
  return `discord-${cleanGuildId}-${cleanChannelId}`;
}
