# HearMeOut Prod-Ready Media Roadmap

Prepared after the 2026-07-11 media architecture session.

This document is the handoff map for taking HearMeOut from "close but fragile" to a production-ready shared watch/listen/talk experience across HearMeOut rooms, SpaceMountain, Discord Activities, and OBS/stream mode.

## Product Goal

People in the same group should share one synchronized experience:

- They can hear each other talking through a WebRTC voice layer.
- They can watch movies with video and audio in sync.
- They can listen to music with audio, and video/visuals when available, in sync.
- HearMeOut, SpaceMountain, Discord Activity, and OBS surfaces all follow the same source-of-truth state.
- Streamers can separate media audio from voice audio so music/movie audio can be excluded from VODs while voices remain.

The target shape is:

```text
                 shared room identity
                         |
        -------------------------------------
        |                                   |
   media session bus                    voice bus
   movies + music                       people talking
   authoritative state                  WebRTC/LiveKit
        |                                   |
  watch page / activity / overlay      HMO / SpaceMountain / Activity
        |
  OBS media-only source
```

## Non-Goals

These are intentionally out of scope for the first production pass:

- Building a new parallel "remote desktop" media system.
- Making YouTube iframe playback the production shared source for Discord Activity.
- Writing playback position to the database every second.
- Rebuilding HearMeOut from scratch.
- Removing old routes before replacement paths have production evidence.
- Moving public toggles or URLs into secrets.

## Production Definition

This project is prod-ready when all of these are true:

- A room has one canonical media state for the selected lane.
- Movies and music use the same session/control contract.
- A user joining late starts from the live position, not the beginning or stale history.
- Discord Activity does not black-screen because it depended on a third-party iframe.
- Stream Mode exposes separate OBS/browser-source URLs for media and voice.
- Voice continues while media is routed elsewhere for streamers.
- Search/request failures are explicit and do not enqueue unplayable shared media.
- The old music extraction/embed paths are either adapted into the media contract or marked deprecated.
- Health checks and logs distinguish real user-facing playback failures from ignored/non-error noise.
- GitHub Actions, Fly deploys, and live smoke tests pass before calling a change complete.

## Current System Anchors

These are the files that currently matter most.

### Session IDs and Routing

- `src/lib/watch-session.ts`
  - Legacy movie session: `discord-watch-room`
  - Legacy music session: `discord-music-room`
  - Room session pattern: `watch-room-{roomId}-movie|music`
  - Discord session pattern: `watch-discord-{guildId}-{channelId}-movie|music`

### Watch Session State

- `src/lib/watch/watch-request-service.ts`
  - `getWatchSession()`
  - `getResolvedWatchSession()`
  - `getPublicWatchSession()`
  - `getEffectivePlaybackPosition()`
  - `controlWatchSession()`
  - `musicTrackToWatchItem()`
  - `getPublicWatchItem()`

The existing session model already has the right basic idea: store base position plus `updatedAt`, then derive live position from server time. Keep this model. Do not return to per-second writes.

### Watch Players and Discord Activity

- `src/app/watch/[sessionId]/watch-room-client.tsx`
- `src/app/activity/route.ts`
- `src/app/activity-lite.js/route.ts`
- `src/app/activity/activity-client.tsx`
- `src/app/api/watch/sessions/[sessionId]/state/route.ts`
- `src/app/api/watch/sessions/[sessionId]/control/route.ts`
- `src/app/api/watch/sessions/[sessionId]/request/route.ts`

### Movie/HLS Provider Path

- `src/lib/watch/xtream-provider.ts`
- `src/lib/watch/xtream-hls.ts`
- `src/lib/watch/xtream-cache.ts`
- `src/app/api/watch/xtream/hls/[streamId]/[file]/route.ts`
- `src/app/activity-provider/xtream/hls/[streamId]/[file]/route.ts`
- `src/app/activity/watch/xtream/hls/[streamId]/[file]/route.ts`
- `src/app/api/watch/xtream/source/[kind]/[streamId]/route.ts`

This is the backbone to treat as source-of-truth for shared video/audio playback.

### Music Paths

- `src/lib/bot-actions.ts`
- `src/lib/music-command-service.ts`
- `src/lib/music-session-service.ts`
- `src/lib/offline-music.ts`
- `src/app/api/offline-music/route.ts`
- `src/app/api/youtube-audio/route.ts`
- `src/app/api/youtube-audio/stream/route.ts`
- `src/app/api/youtube-audio/proxy/route.ts`
- `worker/src/server.js`

Current risk: music can fall into YouTube iframe or extraction fallback behavior. That is acceptable as an experimental/local path, but not acceptable as the production shared source for Discord Activity.

### Voice and DJ Layer

- `src/app/rooms/[roomId]/page.tsx`
- `src/app/api/livekit-token/route.ts`
- `src/app/api/livekit-health/route.ts`
- `src/lib/peer-audio-service.ts`
- `src/app/dj/[roomId]/page.tsx`
- `src/app/api/dj/route.ts`
- `worker/src/server.js`

The room page already separates voice (`LiveKitRoom`) from music listener behavior (`generateMusicRoomToken`, `PeerAudioListener`). The production design should make that separation clearer and more reliable, not merge all audio into one track.

### OBS and Overlay

- `src/app/overlay/[roomId]/page.tsx`
- `src/app/obs/chat/[roomId]/page.tsx`
- Room UI currently links `/overlay/{roomId}?media=auto`.

The next production pass should add explicit media-only and voice-only surfaces instead of relying on one mixed overlay path.

## Target Architecture

### 1. Media Bus

The media bus owns movies and music. It is the single source of truth for:

- Current item
- Queue
- Status: `idle`, `playing`, `paused`
- Base position
- Last state transition time
- Volume/mute defaults where shared volume is intended
- Item metadata required by every client

State should be event-driven:

- Write on load.
- Write on play.
- Write on pause.
- Write on seek.
- Write on next.
- Write on clear.
- Write on queue changes.

Do not write every second. Clients should compute:

```text
effectivePosition = playback.position + (now - playback.updatedAt) / 1000
```

when status is `playing`.

### 2. Media Playback Plane

Every shared client should receive a first-party playable URL whenever possible:

- HLS `.m3u8` for video/movie-style playback.
- Direct/proxied MP4 only when range/seek support is verified.
- Offline/cached audio URLs for music.
- First-party generated audio/HLS for music when music can be resolved.

The shared production contract should not point Discord Activity at a YouTube iframe as the main path. If a YouTube item cannot be converted into a first-party playable source, it should fail before it becomes the shared current item.

### 3. Voice Bus

Voice is separate from media.

- Primary: LiveKit room per HearMeOut room/shared identity.
- Fallback: PeerJS only as an emergency fallback with clear status.
- Voice room identity must be stable across HearMeOut, SpaceMountain, and Discord Activity.
- Voice must not be disabled by Stream Mode.

### 4. Stream Mode

Stream Mode is per-user output routing, not a separate media state.

Required production surfaces:

- `/overlay/{roomId}?media=auto` remains compatibility.
- New media-only OBS URL, for example `/obs/room/{roomId}/media`.
- New voice-only OBS URL, for example `/obs/room/{roomId}/voice`.
- Optional combined preview URL, for example `/obs/room/{roomId}/combined`.

Expected behavior:

- Normal room users hear media and voices in the room.
- Stream Mode users keep voice in the main room and send media to the OBS media-only source.
- OBS can place media on a VOD-muted track and voice on a normal track.

### 5. Discord Activity

Discord Activity should be a client of the same media bus.

It should:

- Load the same session state as HearMeOut/SpaceMountain.
- Play first-party media URLs.
- Avoid third-party iframe dependency for the shared production path.
- Join the same voice room where platform permissions allow microphone/audio capture.
- Show an explicit unsupported-source state when a track cannot be shared, before playback starts.

## Media Item Contract

Future devs should converge the code toward a normalized media item shape.

Suggested contract:

```ts
type SharedMediaKind = 'movie' | 'music';
type SharedMediaAssetKind = 'hls' | 'mp4' | 'audio' | 'external-preview';

type SharedMediaItem = {
  id: string;
  kind: SharedMediaKind;
  title: string;
  sourceLabel: string;
  durationSeconds?: number;
  posterUrl?: string;
  playback: {
    assetKind: SharedMediaAssetKind;
    url: string;
    mimeType?: string;
    seekable: boolean;
    firstParty: boolean;
  };
  provider: {
    name: 'xtream' | 'offline' | 'youtube' | 'internet-archive' | 'test' | 'tts';
    originalUrl?: string;
    externalId?: string;
  };
};
```

Important rule:

- `external-preview` may exist for a local preview or search result.
- `external-preview` must not become the production shared current item for Discord Activity.

## Source Resolution Rules

### Movies

Preferred order:

1. Xtream/HLS first-party route.
2. Internet Archive or public HLS when validated.
3. Direct MP4 only when CORS, range, and seeking work.
4. Reject with a clear message.

### Music

Preferred order:

1. Offline/cached library match.
2. First-party playable cached/proxied audio.
3. First-party HLS/audio generated by a controlled worker pipeline.
4. External preview only for local/manual preview, not shared prod playback.
5. Reject with a clear message.

Do not enqueue a YouTube result into a shared session until a first-party playable source has been validated.

## Route Consolidation Plan

Keep these as production routes:

- `/api/watch/sessions/[sessionId]/state`
- `/api/watch/sessions/[sessionId]/request`
- `/api/watch/sessions/[sessionId]/control`
- `/api/watch/sessions/[sessionId]/accept`
- `/watch/[sessionId]`
- `/activity?sessionId=...`
- `/overlay/[roomId]`
- Future `/obs/room/[roomId]/media`
- Future `/obs/room/[roomId]/voice`

Adapt or deprecate these after the new contract is live:

- `/api/music/session/state`
- `/api/music/session/request`
- `/api/music/session/control`
- `/api/youtube-audio`
- `/api/youtube-audio/stream`
- `/api/youtube-audio/proxy`
- `/activity-state/[sessionId]`
- `/activity-request/[sessionId]`
- `/activity-control/[sessionId]`
- duplicate `/watch/sessions/...` routes if they are only legacy aliases

Do not remove aliases until live traffic and Discord commands are verified.

## Configuration and State Policy

Follow the workspace policy:

- Secrets belong in env/Fly secrets.
- Public runtime config belongs in volume-backed JSON.
- App state belongs in the database or the current app state store.
- Local `.env` is dev convenience only and remains gitignored.
- Do not store secrets in JSON.

For this roadmap:

- LiveKit API keys are secrets.
- Worker callback secrets are secrets.
- Public app URLs and feature toggles are public runtime config.
- Current queues/playback state are app state.
- Local worker/debug flags are local-only debug unless intentionally promoted.

## Road To Production

### Phase 0 - Freeze and Baseline

Goal: know exactly what works today before changing anything.

Tasks:

- [ ] Confirm clean git status in `hearmeout-main`.
- [ ] Create a branch for the media roadmap work.
- [ ] Save a live baseline of:
  - [ ] `/api/health`
  - [ ] `/api/livekit-health`
  - [ ] `/api/watch/sessions/discord-watch-room/state`
  - [ ] `/api/watch/sessions/discord-music-room/state`
  - [ ] `/watch/discord-watch-room`
  - [ ] `/watch/discord-music-room`
  - [ ] `/activity?sessionId=discord-watch-room`
  - [ ] `/activity?sessionId=discord-music-room`
  - [ ] `/overlay/{knownRoomId}?media=auto`
- [ ] Record one known-good movie test item.
- [ ] Record one known-good music/offline item if available.
- [ ] Record one known-bad YouTube music item that reproduces Discord black screen or extraction failure.

Reasoning:

This prevents a future dev from mistaking an old failure for a new regression.

Exit criteria:

- A baseline note exists with request URLs, status codes, screenshots where useful, and current git SHA.

### Phase 1 - Trace The Two Truth Paths

Goal: identify the working movie path and the intended music path without editing behavior.

Tasks:

- [ ] Trace a movie request from command/search to state to player.
- [ ] Trace a music request from `!sr`/room UI to state to player.
- [ ] Trace Discord Activity session selection.
- [ ] Trace overlay media selection.
- [ ] Trace room voice join and music-listener join.
- [ ] Produce a route inventory table:
  - route
  - owner file
  - media kind
  - current status: keep, adapt, alias, deprecate, remove later
  - live evidence

Reasoning:

Cleanup is only safe once every route is classified. Routes that look dead may still be Discord aliases, overlay aliases, or legacy user bookmarks.

Exit criteria:

- Route inventory committed in docs.
- No code behavior changed yet.

### Phase 2 - Normalize Shared Media Contract

Goal: make movies and music use one media item/session contract.

Tasks:

- [ ] Add a small shared media contract module, likely under `src/lib/watch/`.
- [ ] Normalize movie provider output into the contract.
- [ ] Normalize offline music output into the contract.
- [ ] Normalize YouTube/music search output as `pending` until first-party playback is validated.
- [ ] Preserve existing session ID behavior from `src/lib/watch-session.ts`.
- [ ] Keep legacy session IDs working.
- [ ] Add targeted tests around media item normalization.

Reasoning:

The player should not care whether the item came from Xtream, offline music, YouTube search, or a test catalog. It should only care whether it received a playable first-party asset and how to sync it.

Exit criteria:

- Movie and offline/cached music can both appear as normalized shared media items.
- Unvalidated YouTube items do not become shared current media.

### Phase 3 - Make Music Use The Movie-Style Media Path

Goal: music becomes a first-class shared media item, not a separate fragile playback stack.

Tasks:

- [ ] Change music request flow to resolve playable media before enqueue.
- [ ] If offline/cached match exists, enqueue it.
- [ ] If worker can produce a first-party playable audio/HLS URL, enqueue it.
- [ ] If only external iframe/embed is available, return a clear "not shareable yet" response.
- [ ] Add a visible status for "resolving music" when resolution takes time.
- [ ] Add telemetry for:
  - search hit
  - playable source resolved
  - source rejected
  - extraction failed
  - queued
  - playback started

Reasoning:

The user experience should fail at request time, not after everyone joins a black screen.

Exit criteria:

- A music item that cannot be first-party played cannot become the shared current item.
- A playable music item works in the same state/control/player loop as a movie.

### Phase 4 - Unify Players

Goal: HearMeOut room, watch page, Discord Activity, SpaceMountain, and overlay use one player core.

Tasks:

- [ ] Extract shared player logic from `activity-lite.js` and `watch-room-client.tsx` where practical.
- [ ] Use the same HLS/native/audio decision logic everywhere.
- [ ] Use the same effective position calculation everywhere.
- [ ] Keep Activity-specific shell code small.
- [ ] Add player-level support for:
  - [ ] HLS video
  - [ ] MP4/native video
  - [ ] audio-only music with visual/metadata surface
  - [ ] seek/sync
  - [ ] paused state
  - [ ] ended/next behavior
  - [ ] media error reporting

Reasoning:

Discord Activity should not have a special copy of playback rules that drifts away from the watch page.

Exit criteria:

- One known-good movie plays in watch page, Activity, and overlay.
- One known-good music item plays in watch page, Activity, and overlay.
- Late joiners sync to current position in every surface.

### Phase 5 - Voice Bus Stabilization

Goal: people can hear each other everywhere the platform allows.

Tasks:

- [ ] Define canonical voice room ID for each shared media room.
- [ ] Confirm HearMeOut room joins LiveKit voice using that ID.
- [ ] Confirm SpaceMountain can join or consume the same voice identity.
- [ ] Confirm Discord Activity can join voice where browser/Discord permissions allow.
- [ ] Keep PeerJS fallback behind clear status and logging.
- [ ] Split media audio from voice audio in UI state and OBS state.
- [ ] Add a voice health indicator visible to users.

Reasoning:

Voice is part of the watch party, but it must stay independent so Stream Mode can route media away without muting people.

Exit criteria:

- Two browser users can hear each other while watching a movie.
- Two browser users can hear each other while listening to music.
- Stream Mode does not disable voice.

### Phase 6 - OBS Stream Mode Outputs

Goal: provide production-safe browser sources for streamers.

Tasks:

- [ ] Add media-only OBS page.
- [ ] Add voice-only OBS page.
- [ ] Keep current chat overlay separate.
- [ ] Keep `/overlay/{roomId}?media=auto` as compatibility.
- [ ] Add a copy-controls UI in room header:
  - [ ] copy media-only URL
  - [ ] copy voice-only URL
  - [ ] copy chat URL
  - [ ] copy combined preview URL if built
- [ ] Document recommended OBS audio tracks:
  - media source on VOD-muted track
  - voice source on normal track
  - chat visual source with no audio

Reasoning:

OBS should not depend on the streamer manually muting the right browser tab. The app should expose separable sources.

Exit criteria:

- In OBS/browser testing, media audio and voice audio can be captured independently.
- Stream Mode user can keep participating in voice while media is routed to OBS.

### Phase 7 - Deprecation and Cleanup

Goal: remove confusing old paths only after replacement paths are proven.

Tasks:

- [ ] Mark old music session APIs as aliases or deprecated.
- [ ] Mark YouTube iframe fallback as non-prod/shared-disabled.
- [ ] Add warnings when deprecated routes are hit.
- [ ] Watch logs for deprecated route usage after deploy.
- [ ] Remove unused code only after at least one successful deploy cycle with no traffic or known dependencies.

Reasoning:

The current codebase has scars from failed approaches. The fix is not a large delete first. The fix is to make the new path undeniable, then delete what no longer receives traffic.

Exit criteria:

- Deprecated route usage is known.
- No Discord command, room UI, Activity URL, or overlay URL depends on removed code.

### Phase 8 - Observability and Rotator/Error Hygiene

Goal: user-facing playback failures should be visible, and non-errors should not drown them out.

Tasks:

- [ ] Log media resolution failure separately from playback failure.
- [ ] Log Activity media errors with session ID, media ID, provider, and asset kind.
- [ ] Log worker extraction failures with reason and source ID.
- [ ] Add health endpoint detail for media worker readiness.
- [ ] Add ignore rules only for proven non-errors.
- [ ] Do not treat "rotator zero errors" as proof of media health unless playback smoke tests passed.

Reasoning:

The current failure can look clean to the rotator while users stare at a black screen. Production readiness needs user-path checks.

Exit criteria:

- Failed media path appears in logs or dashboard.
- Known non-errors are ignored.
- Real media failures remain visible.

### Phase 9 - Validation, Push, Deploy

Goal: ship only after local, CI, and live checks agree.

Local validation:

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] targeted ESLint on changed files
- [ ] `git diff --check`
- [ ] local smoke for movie state/playback
- [ ] local smoke for music state/playback
- [ ] local smoke for Activity HTML/JS
- [ ] local smoke for overlay/OBS pages

Repository validation:

- [ ] Commit with a narrow message.
- [ ] Push branch.
- [ ] Open PR or merge only after review.
- [ ] Verify GitHub Actions.

Production validation:

- [ ] Verify Fly deploy completed.
- [ ] Smoke `/api/health`.
- [ ] Smoke `/api/livekit-health`.
- [ ] Smoke movie state endpoint.
- [ ] Smoke music state endpoint.
- [ ] Smoke watch page.
- [ ] Smoke Discord Activity.
- [ ] Smoke overlay.
- [ ] Smoke OBS media-only source.
- [ ] Smoke OBS voice-only source.
- [ ] Confirm rotator dashboard does not hide real playback failures.

Exit criteria:

- A fresh user joining after playback starts lands at the right position.
- Discord Activity plays the same media as HearMeOut.
- Stream Mode separates media and voice.
- No new broad errors are introduced.

## Immediate Step-By-Step TODO

Start here in the next coding session.

### Step 1 - Create Baseline Branch

- [ ] Confirm `git status --short` is clean.
- [ ] Create a branch named something like `media-prod-roadmap-phase-1`.
- [ ] Do not deploy during tracing.

### Step 2 - Build Route Inventory

- [ ] Make `docs/HEARMEOUT_MEDIA_ROUTE_INVENTORY.md`.
- [ ] Inventory every route matching:
  - `watch`
  - `activity`
  - `overlay`
  - `obs`
  - `music`
  - `youtube-audio`
  - `dj`
  - `livekit`
- [ ] Classify each route as `keep`, `adapt`, `alias`, `deprecate`, or `remove later`.

### Step 3 - Baseline Smoke Tests

- [ ] Pick one movie that works.
- [ ] Pick one music item that works or document that none currently does.
- [ ] Pick one music item that fails.
- [ ] Test each through:
  - [ ] `/watch/{sessionId}`
  - [ ] `/activity?sessionId={sessionId}`
  - [ ] `/overlay/{roomId}?media=auto`
  - [ ] room page

### Step 4 - Contract Draft

- [ ] Add a shared media contract module.
- [ ] Convert movie items into the contract.
- [ ] Convert offline/cached music into the contract.
- [ ] Leave YouTube/external items as pending until playable source exists.

### Step 5 - Music Gate

- [ ] Update song request flow so unplayable music is rejected before enqueue.
- [ ] Keep the user-facing message plain:
  - "I found the song, but it is not share-playable yet."
  - "Try an offline/cached copy or another result."
- [ ] Log the rejection with provider and reason.

### Step 6 - Activity Player Alignment

- [ ] Remove Activity-only assumptions about YouTube embed being the video path.
- [ ] Make Activity consume the same normalized playback decision as the watch page.
- [ ] Keep Discord-specific UI shell minimal.

### Step 7 - OBS Split

- [ ] Add media-only OBS page.
- [ ] Add voice-only OBS page.
- [ ] Add copy buttons.
- [ ] Validate with two browser tabs before OBS.

### Step 8 - Cleanup Pass

- [ ] Add deprecation warnings to old routes.
- [ ] Confirm traffic/log usage.
- [ ] Remove only after replacement path has live evidence.

## Risks and Mitigations

### Risk: YouTube Extraction Fails By Track

Mitigation:

- Treat YouTube search as discovery, not guaranteed playback.
- Require playable first-party URL before enqueue.
- Prefer offline/cached music for production shared playback.

### Risk: Discord Activity Sandbox Blocks Third-Party Media

Mitigation:

- Use first-party HLS/audio/media URLs.
- Do not rely on YouTube iframe for production shared playback.

### Risk: Voice and Media Audio Get Mixed

Mitigation:

- Keep voice bus separate from media bus.
- Create explicit OBS media-only and voice-only pages.
- Do not pipe all audio through one browser element.

### Risk: Cleanup Breaks Legacy Commands

Mitigation:

- Keep aliases until live route usage is known.
- Verify Discord commands and Activity invite URLs after deploy.

### Risk: State Desync

Mitigation:

- Store transitions only.
- Use server time and `updatedAt`.
- Add sync button and auto-correction threshold in clients.

## Decision Log

- The movie path is the production backbone.
- Music should be adapted into the movie-style media/session contract.
- Voice remains a separate WebRTC/LiveKit layer.
- OBS needs separate media and voice surfaces.
- YouTube iframe is not a production shared source for Discord Activity.
- Headless-browser YouTube display should not become the main product path.
- Cleanup happens after the new path is verified, not before.

## Handoff Notes For Future Developers

- Start with this document, then read `HEARMEOUT_ROOM_SCOPED_MEDIA_PLAN.md`, `MUSIC_STREAMING_TODO.md`, and `WEBRTC_FIXES.md` as historical context.
- Do not assume an old TODO is still the desired direction. This document is the current target.
- Before editing config, classify it as secret, public runtime config, app state, or local-only debug.
- Before deleting a route, prove who calls it.
- Before claiming "fixed", test HearMeOut, Discord Activity, and OBS/overlay surfaces.
- Keep changes narrow. This app is close enough that broad rewrites are more dangerous than helpful.
