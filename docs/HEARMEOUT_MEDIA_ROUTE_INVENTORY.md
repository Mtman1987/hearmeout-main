# HearMeOut Media Route Inventory

Prepared from the current App Router files during the 2026-07-11 production-readiness pass.

This inventory supports the canonical [suite production roadmap](https://github.com/Mtman1987/spmt-live/blob/main/docs/ecosystem/PRODUCTION_ROADMAP.md). Its job is to preserve route evidence before changing the media playback architecture; it is not a separate backlog.

## Classification Legend

- `keep`: production path or required health/control surface.
- `adapt`: still needed, but must be reshaped to the target media/voice contract.
- `alias`: compatibility route that forwards or re-exports canonical behavior.
- `deprecate`: old path that should be replaced by a canonical route, then watched for traffic before removal.
- `remove later`: only after logs and callers prove it is unused.

## Findings From This Pass

- The canonical watch session API is `/api/watch/sessions/[sessionId]/*`.
- `/watch/sessions/[sessionId]/*` and `/activity/session/[sessionId]/*` mostly re-export the canonical watch API and should stay as temporary aliases.
- The older root-level Activity API routes (`/activity-state`, `/activity-request`, `/activity-control`) duplicate behavior instead of re-exporting the canonical API and should be deprecated or converted to aliases.
- The legacy `/api/music/session/request` endpoint was defaulting to the movie session when no `sessionId` was supplied. This pass changes that default to the music watch session.
- YouTube audio/video proxy routes are not safe as the production shared-media source. They can remain as experimental adapters while the app moves music onto first-party playable media.
- Current OBS support is mostly media/chat oriented. A voice-only OBS surface does not exist yet.

## Canonical Target

All shared media should converge here:

| Capability | Canonical Route |
| --- | --- |
| Read session state | `/api/watch/sessions/[sessionId]/state` |
| Request movie/music/TTS | `/api/watch/sessions/[sessionId]/request` |
| Control playback | `/api/watch/sessions/[sessionId]/control` |
| Quick Discord-style control | `/api/watch/sessions/[sessionId]/quick-control` |
| Accept recommendation | `/api/watch/sessions/[sessionId]/accept` |
| Watch player | `/watch/[sessionId]` |
| Discord Activity shell | `/activity?sessionId=...` |
| Room media overlay | `/overlay/[roomId]?media=auto|movie|music` |

## Watch Session Routes

| Route | File | Class | Notes |
| --- | --- | --- | --- |
| `/api/watch/sessions/[sessionId]/state` | `src/app/api/watch/sessions/[sessionId]/state/route.ts` | keep | Canonical public state reader. Uses `getResolvedWatchSession()` and `getPublicWatchSession()`. |
| `/api/watch/sessions/[sessionId]/request` | `src/app/api/watch/sessions/[sessionId]/request/route.ts` | keep | Canonical request route for movie, music, and TTS. Supports Discord announcement. |
| `/api/watch/sessions/[sessionId]/control` | `src/app/api/watch/sessions/[sessionId]/control/route.ts` | keep | Canonical POST control route with actor metadata and permission checks. |
| `/api/watch/sessions/[sessionId]/quick-control` | `src/app/api/watch/sessions/[sessionId]/quick-control/route.ts` | keep | GET control path used by Discord/button-style clients. |
| `/api/watch/sessions/[sessionId]/accept` | `src/app/api/watch/sessions/[sessionId]/accept/route.ts` | keep | Canonical recommendation accept route. |
| `/watch/[sessionId]` | `src/app/watch/[sessionId]/page.tsx` | keep | Main web watch page shell. |
| `/watch/[sessionId]` client | `src/app/watch/[sessionId]/watch-room-client.tsx` | adapt | Main player logic. Still contains YouTube embed mode and duplicated playback decisions also present in Activity/Overlay. |
| `/watch/sessions/[sessionId]/state` | `src/app/watch/sessions/[sessionId]/state/route.ts` | alias | Re-exports canonical API route. Keep until callers are known. |
| `/watch/sessions/[sessionId]/request` | `src/app/watch/sessions/[sessionId]/request/route.ts` | alias | Re-exports canonical API route. |
| `/watch/sessions/[sessionId]/control` | `src/app/watch/sessions/[sessionId]/control/route.ts` | alias | Re-exports canonical API route. |
| `/watch/sessions/[sessionId]/accept` | `src/app/watch/sessions/[sessionId]/accept/route.ts` | alias | Re-exports canonical API route. |
| `/api/watch/catalog` | `src/app/api/watch/catalog/route.ts` | keep | Test/static catalog endpoint. Useful for smoke tests. |
| `/api/watch/search` | `src/app/api/watch/search/route.ts` | keep | Provider search entry point. Next pass should return normalized shared media candidates. |
| `/api/watch/activity-default` | `src/app/api/watch/activity-default/route.ts` | keep | Activity default-session resolver. |
| `/api/watch/proxy` | `src/app/api/watch/proxy/route.ts` | keep | Allowlisted first-party proxy for public test/HLS/archive media. |

## Movie and HLS Routes

| Route | File | Class | Notes |
| --- | --- | --- | --- |
| `/api/watch/xtream/status` | `src/app/api/watch/xtream/status/route.ts` | keep | Provider readiness and diagnostics. |
| `/api/watch/xtream/source/[kind]/[streamId]` | `src/app/api/watch/xtream/source/[kind]/[streamId]/route.ts` | keep | Worker-only source URL resolver. Protected by DJ worker auth. |
| `/api/watch/xtream/hls/[streamId]/[file]` | `src/app/api/watch/xtream/hls/[streamId]/[file]/route.ts` | keep | First-party HLS backbone for browser/Activity-safe playback. |
| `/xtream/hls/[streamId]/[file]` | `src/app/xtream/hls/[streamId]/[file]/route.ts` | alias | Re-exports canonical HLS route. |
| `/activity-provider/xtream/[kind]/[streamId]` | `src/app/activity-provider/xtream/[kind]/[streamId]/route.ts` | keep | Direct/ranged Xtream stream provider for Activity/watch clients. |
| `/activity-provider/xtream/hls/[streamId]/[file]` | `src/app/activity-provider/xtream/hls/[streamId]/[file]/route.ts` | alias | Re-exports canonical HLS route. |
| `/activity/watch/xtream/hls/[streamId]/[file]` | `src/app/activity/watch/xtream/hls/[streamId]/[file]/route.ts` | alias | Re-exports canonical HLS route for Activity path compatibility. |

## Activity Routes

| Route | File | Class | Notes |
| --- | --- | --- | --- |
| `/activity` | `src/app/activity/route.ts` | adapt | Main Discord Activity HTML shell. Currently still chooses YouTube embed for music video mode; must converge on first-party media. |
| `/activity` client | `src/app/activity/activity-client.tsx` | adapt | React client path. Verify whether still active before deeper edits. |
| `/activity-lite.js` | `src/app/activity-lite.js/route.ts` | adapt | Main generated JS player used by Activity. Duplicates watch-player logic and has YouTube fallback behavior. |
| `/activity-lite` | `src/app/activity-lite/route.ts` | alias | Redirects to `/activity`. |
| `/api/activity/hls` | `src/app/api/activity/hls/route.ts` | alias | Re-exports `/activity-hls`. |
| `/activity/hls` | `src/app/activity/hls/route.ts` | alias | Re-exports `/activity-hls`. |
| `/activity-hls` | `src/app/activity-hls/route.ts` | keep | Serves bundled `hls.light.min.js` to Activity. |
| `/activity/proxy` | `src/app/activity/proxy/route.ts` | alias | Re-exports watch proxy. |
| `/activity-proxy` | `src/app/activity-proxy/route.ts` | alias | Re-exports watch proxy. |
| `/activity/session/[sessionId]/state` | `src/app/activity/session/[sessionId]/state/route.ts` | alias | Re-exports canonical watch state route. |
| `/activity/session/[sessionId]/request` | `src/app/activity/session/[sessionId]/request/route.ts` | alias | Re-exports canonical watch request route. |
| `/activity/session/[sessionId]/quick-control` | `src/app/activity/session/[sessionId]/quick-control/route.ts` | alias | Re-exports canonical quick-control route. |
| `/activity/session/[sessionId]/accept` | `src/app/activity/session/[sessionId]/accept/route.ts` | alias | Re-exports canonical accept route. |
| `/activity-state/[sessionId]` | `src/app/activity-state/[sessionId]/route.ts` | deprecate | Older duplicate state reader; should become alias or be removed after traffic check. |
| `/activity-request/[sessionId]` | `src/app/activity-request/[sessionId]/route.ts` | deprecate | Older duplicate request route; does not include all canonical request behavior. |
| `/activity-request/[sessionId]/accept` | `src/app/activity-request/[sessionId]/accept/route.ts` | deprecate | Older duplicate accept route. |
| `/activity-control/[sessionId]` | `src/app/activity-control/[sessionId]/route.ts` | deprecate | Older duplicate control route with weaker actor context. |
| `/activity-worker/[...path]` | `src/app/activity-worker/[...path]/route.ts` | adapt | Redirects to DJ worker paths. Keep only if Activity still needs worker-origin compatibility. |

## Music Routes

| Route | File | Class | Notes |
| --- | --- | --- | --- |
| `/api/music/session/state` | `src/app/api/music/session/state/route.ts` | deprecate | Reads old `music-session-service` global state. Should converge to `/api/watch/sessions/discord-music-room/state`. |
| `/api/music/session/request` | `src/app/api/music/session/request/route.ts` | adapt | Legacy music request route. Now defaults to `discord-music-room`; should eventually alias canonical watch request. |
| `/api/music/session/control` | `src/app/api/music/session/control/route.ts` | deprecate | Controls old global music state. Should converge to canonical watch-session control. |
| `/api/music/[videoId]` | `src/app/api/music/[videoId]/route.ts` | deprecate | Old worker proxy for `/music/{videoId}`. Keep only if live callers exist. |
| `/api/offline-music` | `src/app/api/offline-music/route.ts` | keep | Strong candidate for first-party music source. Supports search and range streaming through worker. |
| `/api/youtube-audio` | `src/app/api/youtube-audio/route.ts` | adapt | Worker extraction facade. Discovery/experimental only until playable-source validation is enforced. |
| `/api/youtube-audio/stream` | `src/app/api/youtube-audio/stream/route.ts` | adapt | Attempts worker stream then extracted audio range proxy. Do not treat as guaranteed shared source. |
| `/api/youtube-audio/proxy` | `src/app/api/youtube-audio/proxy/route.ts` | adapt | Client/worker-registered CDN proxy. Useful fallback, not a production queue guarantee. |
| `/api/youtube-proxy` | `src/app/api/youtube-proxy/route.ts` | deprecate | Generic allowlisted YouTube proxy. Keep only if current browser extractor needs it. |
| `/api/youtube-video/proxy` | `src/app/api/youtube-video/proxy/route.ts` | adapt | Experimental YouTube video/audio range proxy. Not the Activity production path. |

## DJ, Worker, and Voice Routes

| Route | File | Class | Notes |
| --- | --- | --- | --- |
| `/api/dj` | `src/app/api/dj/route.ts` | keep | Main DJ worker control/status proxy. Keep while music publisher exists. |
| `/api/dj-debug` | `src/app/api/dj-debug/route.ts` | deprecate | Explicitly marked deprecated in code; forwards to `/api/dj`. |
| `/dj/[roomId]` | `src/app/dj/[roomId]/page.tsx` | adapt | Browser DJ publisher. Uses LiveKit/Peer fallback. Should remain transitional while music becomes first-party shared media. |
| `/api/livekit-token` | `src/app/api/livekit-token/route.ts` | keep | Mints voice/music LiveKit tokens. Needs future cleanup around canonical voice vs music rooms. |
| `/api/livekit-health` | `src/app/api/livekit-health/route.ts` | keep | LiveKit readiness check. |
| `/api/peer-voice/register` | `src/app/api/peer-voice/register/route.ts` | keep | Peer fallback registry. In-memory and deploy-reset prone; fallback only. |
| `/api/peer-voice/peers` | `src/app/api/peer-voice/peers/route.ts` | keep | Peer fallback discovery. |
| `/api/voice/hearmeout` | `src/app/api/voice/hearmeout/route.ts` | keep | Voice-command room discovery/join surface. Returns room, overlay, movie session, and music session IDs. |

## Room, Overlay, and OBS Surfaces

| Route | File | Class | Notes |
| --- | --- | --- | --- |
| `/rooms/[roomId]` | `src/app/rooms/[roomId]/page.tsx` | adapt | Main room surface. Already separates room voice from Stream Mode media overlay, but media/voice contracts need clearer split. |
| `/overlay/[roomId]` | `src/app/overlay/[roomId]/page.tsx` | keep | Current media overlay. Polls room movie and music sessions and chooses auto/movie/music lane. |
| `/obs/chat/[roomId]` | `src/app/obs/chat/[roomId]/page.tsx` | adapt | Chat/participant overlay. It is not a production voice-only audio source yet. |
| future `/obs/room/[roomId]/media` | not built | adapt | Needed for explicit media-only OBS source. |
| future `/obs/room/[roomId]/voice` | not built | adapt | Needed for explicit voice-only OBS source. |

## Next Code Moves

1. Convert `/api/music/session/state` and `/api/music/session/control` into aliases for the music watch session.
2. Add a normalized shared-media contract under `src/lib/watch/`.
3. Make music requests validate or resolve first-party playback before enqueue.
4. Extract shared player playback-decision helpers so watch, Activity, and overlay stop duplicating YouTube/HLS/audio logic.
5. Add explicit OBS media-only and voice-only pages.
6. Add deprecation logging for old root Activity and old music routes before removing anything.
