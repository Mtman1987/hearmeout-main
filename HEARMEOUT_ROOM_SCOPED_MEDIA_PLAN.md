# Room-Scoped Watch/Music Sessions and Stream Mode Media Routing

## Summary

Goal: make every HearMeOut room and every Discord activity use its own watch/music session so groups do not share queues accidentally. Stream Mode remains user-specific: when off, media plays normally in the room/watch player; when on, media output goes through `/overlay/{roomId}` so streamers can isolate copyrighted media audio from voice chat.

Compatibility rules:
- Existing `/watch/discord-watch-room` and `/watch/discord-music-room` still load.
- Global session constants are legacy fallback only.
- Existing global session data is not migrated or deleted.

## Implementation Steps

1. Add scoped session resolvers in `src/lib/watch-session.ts`.
   - Legacy movie session: `discord-watch-room`.
   - Legacy music session: `discord-music-room`.
   - Room movie session: `watch-room-${cleanRoomId}-movie`.
   - Room music session: `watch-room-${cleanRoomId}-music`.
   - Discord movie session: `watch-discord-${cleanGuildId}-${cleanChannelId}-movie`.
   - Discord music session: `watch-discord-${cleanGuildId}-${cleanChannelId}-music`.

2. Update room UI session selection.
   - Room watch card uses the room movie session.
   - Watch widget uses room movie/music session IDs.
   - Add song widget queues into the room music session.
   - Stream Mode keeps voice in the room and routes media to `/overlay/${roomId}?media=auto`.
   - Normal mode keeps the player in `/watch/${roomScopedSessionId}`.

3. Update overlay session selection.
   - Overlay reads the room music and room movie sessions.
   - Auto lane priority is active music, then active movie, then waiting.
   - Explicit lanes remain `?media=music`, `?media=movie`, and `?media=auto`.

4. Update Discord routing.
   - `!wr` queues into the channel movie session.
   - `!sr` queues into the channel music session.
   - `!controls` returns controls for both scoped sessions for that channel.
   - Discord activity URLs include the scoped `sessionId`.

5. Keep standalone Twitch behavior stable.
   - Standalone Twitch bot paths stay legacy/global unless an explicit room mapping is available.
   - Do not guess room ownership from username.

6. Enforce server-side control permissions.
   - Anyone can add/request.
   - Host/admin can pause, clear, jump, and skip room-scoped sessions.
   - Viewers can play/sync/mute/unmute without pausing the shared session.
   - Discord users can play, next, mute, and unmute by default.
   - Discord pause/clear requires admin/manage permission.

7. Add session metadata lazily.
   - Store `scopeType`, `roomId`, `guildId`, `channelId`, `mediaKind`, `createdAt`, and `lastActiveAt`.
   - Metadata is created when a session is first loaded or created.

## Test Plan

1. Run `npm run typecheck`.
2. Run `npm run build`.
3. Verify two HearMeOut rooms can request different movies/songs without sharing queues.
4. Verify Stream Mode routes media to `/overlay/{roomId}?media=auto` while voice stays in the room.
5. Verify host/admin controls can pause/clear/skip and non-host controls cannot.
6. Verify two Discord channels receive separate `!wr`, `!sr`, and `!controls` sessions.
7. Verify legacy `/watch/discord-watch-room` and `/watch/discord-music-room` still load.

## Assumptions And Defaults

- Room-scoped sessions are the default for HearMeOut rooms.
- Discord channel-scoped sessions are the default for Discord commands and activities.
- Global sessions remain as legacy fallback.
- Stream Mode is per-user and defaults off.
- Stream Mode affects media output only; it must not disable voice chat.
- No automatic migration of global queues into scoped sessions.
