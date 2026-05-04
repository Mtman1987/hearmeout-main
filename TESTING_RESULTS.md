# HMO Testing Results — 2026-07-14

## Fixed This Batch

- [x] DSH crash: `/api/db` blocking own frontend (401 on same-origin GET)
- [x] Mute indicator: speaking ring now red when muted, green when unmuted
- [x] Discord status check: graceful error handling on non-OK responses
- [x] use-oauth.ts: rewrote as session wrappers
- [x] auth/complete: accepts user_id param
- [x] twitch/exchange: fixed client_id and redirect_uri
- [x] fly.toml: removed NEXT_PUBLIC_TWITCH_CLIENT_SECRET
- [x] hearmeout-service.ts: migrated to SQLite
- [x] next.config.ts: deleted

## Known Issues — Needs Future Work

### Music/Audio (WebRTC/LiveKit)
- [x] Songs don't auto-advance — must manually hit next
  - Fixed: added fallback auto-advance in DJ poll loop in addition to `onEnded` handler
- [x] Song restarts on any room state change
  - Fixed: added `localVolumeRef` so the music LiveKit connection effect no longer depends on `localVolume` and stops tearing down on every volume slider change
- [ ] Pause button doesn't mute locally — still hear music
  - Pause should set local volume to 0, not stop the track (others still listening)
- [x] Volume controls not working (stale closure fix)
  - Fixed: `attachTrack` now reads from `localVolumeRef.current`, so volume changes apply without remounting the audio element
- [ ] Stream mode doesn't redirect audio to browser source
  - Needs investigation — may need separate audio routing logic
- [ ] Music should be fire-and-forget via WebRTC
  - Currently tied to React component lifecycle
  - Should publish audio track once and let LiveKit handle distribution

### Twitch Bot
- [x] `setInterval` leak in twitch-bot route
  - Fixed: `BotInstance` now tracks `syncInterval`; cleared on reconnect, on notice-triggered re-auth, and on `restart` action before disconnecting the client

### Rooms
- [ ] Private rooms not accessible after leaving
  - No way to find/rejoin a private room — need invite link or room code
  - Consider: generate shareable link on creation, show in room header
- [ ] No room editing (name, description) after creation
  - Need edit dialog accessible from room header or settings
- [ ] No password/access control for private rooms
  - Private just means hidden from public list, not actually restricted

### User Card / Settings
- [ ] Discord server ID saves but shows "not configured"
  - The settings page Discord status checks DSH OAuth status endpoint
  - The guild ID save in UserCard dropdown is separate (per-room, not global)
  - These are two different things — need to clarify UX
- [ ] Muted mic still transmits audio
  - Need to verify `setMicrophoneEnabled(false)` actually stops the track
  - May need to also call `localParticipant.audioTrackPublications` stop

### Overlay
- [ ] Toggle states don't sync between main page and overlay
  - Uses localStorage which doesn't sync across tabs reliably
  - Need BroadcastChannel API or polling
- [ ] Overlay requires manual refresh to see changes
  - Same localStorage sync issue
- [ ] Queue shows songs in wrong order
  - Playlist array order vs currentTrackId index mismatch
- [ ] Profile toggle from overlay card not working
  - Click handler may not be wired up

### Chat Widget
- [ ] Discord channel selection not working
  - Likely the guild ID isn't saved/loaded correctly
- [ ] Twitch chat: "www.twitch.tv refused to connect"
  - Twitch embeds need `parent` parameter matching the hosting domain
  - Need to add `hearmeout-main.fly.dev` to Twitch embed parent list
- [ ] Admin chat history not loading
  - May be looking at wrong collection path
- [ ] AI sentiment check always says "neutral"
  - Genkit/Gemini integration may not be configured in production
  - Consider removing or making optional

### Future Features (from testing notes)
- [ ] 3 connection dots in header: RTC, Twitch, Discord
- [ ] Discord Activity SDK integration (iframe in Discord VC)
- [ ] "Push to Twitch" option for room sharing (tinyurl links)
- [ ] Discord embed controls (ephemeral audio controls, song request modal)
- [ ] Remote users via Discord Activity show Discord logo on their card
