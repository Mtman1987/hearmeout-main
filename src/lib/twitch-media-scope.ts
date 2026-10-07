// Twitch queues never alias to the shared Discord/Lounge sessions.
export function twitchMusicSessionId(tenantId: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(tenantId)) throw new Error('A valid Twitch tenant is required');
  return `watch-twitch-${tenantId.toLowerCase()}-music`;
}
export function isTwitchMusicSession(id: string) {
  return /^watch-twitch-[a-z0-9_-]{1,100}-music$/.test(id);
}
