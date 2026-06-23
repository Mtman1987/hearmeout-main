export const GLOBAL_WATCH_SESSION_ID = 'discord-watch-room';

export function getGlobalWatchSessionId() {
  return GLOBAL_WATCH_SESSION_ID;
}

export function getScopedWatchSessionId(_guildId?: string | null, _channelId?: string | null) {
  return GLOBAL_WATCH_SESSION_ID;
}
