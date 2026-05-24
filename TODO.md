# HearMeOut Last 10 Percent

Goal: make Discord, Twitch, HearMeOut, admin chat, Discord Activity, and OBS overlay all operate from one shared watch state, one shared music state, and one voice bridge.

## Service Boundaries
- Next app: command routing, shared queue/playback state, Discord/Twitch/admin APIs, browser clients, WebRTC signaling, and lightweight proxying.
- DJ worker: CPU-heavy media extraction, video/audio conversion, ffmpeg, cache warming, and publishing audio/video streams when a shared browser player is not enough.
- Rule of thumb: if it can block the event loop, transcode, or buffer large media, send it to the DJ worker; if it is state, commands, UI, or WebRTC coordination, keep it in Next.

## Phase 1: Unified Commands
- [x] Make `!wr` use one global Discord Activity watch room instead of guild/channel scoped sessions.
- [x] Route `!sr <song>` through one command handler from Twitch chat.
- [x] Route `!sr <song>` through the same handler from Discord chat polling.
- [x] Route `!sr <song>` through the same handler from `/api/discord/chat`.
- [x] Route `!sr <song>` and `!wr <movie>` through admin chat before saving the message.
- [x] Keep `!np`, `!status`, and skip responses reading from the same music state.

## Phase 2: Unified Music Session
- [x] Pick one global music room ID for all chat commands (`GLOBAL_MUSIC_ROOM_ID`, `TARGET_ROOM_ID`, or `default`).
- [ ] Create a watch-party-style music session API, separate from room-scoped DJ WebRTC.
- [ ] Store one global song queue, current song, playback status, position, and updated timestamp.
- [ ] Add request/search logic once, then have every `!sr` source call it.
- [ ] Replace pause semantics with local volume/mute where possible so listeners do not desync themselves.
- [ ] Keep global skip as an authoritative control: if one authorized surface skips, everyone advances.
- [ ] Decide whether the canonical music player uses YouTube embed/player state, proxied audio, or existing YouTube audio routes.

## Phase 3: Discord Activity Music
- [ ] Add a music panel/route inside Discord Activity beside the watch party UI.
- [ ] Let Discord Activity users submit `!sr` or form-based song requests.
- [ ] Subscribe the Activity player to the global music session.
- [ ] Verify autoplay/audio unlock behavior in Discord iframe.

## Phase 4: HearMeOut Room Integration
- [ ] Point room DJ/music cards at the global music session instead of local room playlist for shared listening.
- [ ] Keep per-user volume local.
- [ ] Keep room UI controls for request, queue, now playing, and authorized skip.
- [ ] Preserve existing room voice behavior while music becomes player/session based.

## Phase 5: Voice Bridge
- [ ] Keep LiveKit/PeerJS room voice for HearMeOut users.
- [ ] Add Discord Activity voice connection path so Discord Activity users can talk with HearMeOut users.
- [ ] Confirm Discord iframe permissions and SDK limits for microphone access.
- [ ] Keep music audio separate from voice audio.

## Phase 6: OBS Overlay
- [ ] Keep `/overlay/[roomId]` as the streamer browser source.
- [ ] Add an option for overlay to play global music audio instead of the main room page.
- [ ] Keep overlay now-playing, queue, and chat widgets connected to the same global music/watch state.
- [ ] Make stream mode mute/disable main-room music while overlay carries music for OBS routing.
- [ ] Verify overlay remains transparent and low-noise when no track is playing.

## Phase 7: Cleanup
- [ ] Remove or isolate fragile DJ WebRTC paths once the player/session music path is stable.
- [ ] Remove obsolete room-scoped music queue assumptions.
- [ ] Add smoke tests for `!wr`, `!sr`, Activity state, admin chat commands, and overlay music mode.
