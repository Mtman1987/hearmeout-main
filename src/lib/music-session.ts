export const DEFAULT_GLOBAL_MUSIC_ROOM_ID = '';

export function getGlobalMusicRoomId() {
  return (
    process.env.GLOBAL_MUSIC_ROOM_ID ||
    process.env.TARGET_ROOM_ID ||
    DEFAULT_GLOBAL_MUSIC_ROOM_ID
  ).trim();
}
