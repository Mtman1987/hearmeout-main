# Shared playback contract

HearMeOut has one music session (`discord-music-room`) and one movie session
(`discord-watch-room`). These historical IDs are storage keys, not a Discord
ownership boundary. Every room, Activity, popout, watch link and overlay is a
view of those two sources. Adding a room or opening another view must never
create another producer, queue or upstream account session.

`watch-session.ts` normalizes entry-point aliases. `watch-request-service.ts`
owns the two persisted queues. Previous room-scoped sessions are retained as
`retiredSessions` for data preservation; they are not active playback sources.
The automatic-radio profile is stored independently of expiring voice rooms.

The media worker's `SharedMediaRelay` has two serialized slots, keyed only by
`music` and `movie`. It validates the current request with the app before
replacing a source and closes the former producer before resolving/opening the
replacement. Failed resolution is deduplicated; failed completion callbacks
retry. The worker reconciles persisted playback after restart without requiring
a browser to be open.

Each slot produces one paced fMP4 HLS stream. Every viewer reads the same rolling
manifest and segments through `/api/watch/stream/{kind}/{file}`. Request IDs
fence manifests, initialization files and segments against old sources. The
producer keeps a bounded rolling buffer rather than separate movie copies.
Provider URLs stay behind worker authentication. Audio selection happens once
at the producer: English when present, otherwise default/first audio.

Only authenticated worker completion advances a queue. Duplicate or late
completion callbacks are inert. A viewer's pause, mute, seek, volume, ended,
close or disconnect events must never advance or stop the shared source.

## Listener controls

`/activity` serves the sole player implementation, `shared-player-script.ts`.
Rooms, popouts and overlays embed that page; historical watch/DJ entry points
route there. Request entry points and read-only queues remain available.
Playback, mute, seek, skip, clear, speed and native player controls are absent.
Legacy HTTP, bot-action and Discord controls return an unavailable response.
Legacy per-item converters and direct-provider playback routes are retired.

The only playback adjustment is the listener's volume slider. Zero means zero
local gain while receiving and playing the stream. It must never set a shared
mute flag, pause the producer, or unsubscribe a track. Browser storage holds
volume preferences; shared session responses do not expose volume/mute state.
Web Audio gain is used where available, with native element volume as fallback.
A browser may require the listener to adjust the slider once to allow audio.

LiveKit participant/persona/Discord-mix gain shares a persistent identity key
across cards and popouts and reapplies on track subscription. RoomAudioRenderer
is the single voice renderer. LiveKit Web Audio mixing is enabled. P2P voice
uses the same identity preferences and local gain, including reconnects. A
person's microphone/privacy controls remain voice-input controls.

## Voice-room lifecycle

Opening a media view or requesting media does not create a voice room. An actual
Discord Activity launch can create its ordinary six-hour voice room. Reads,
dashboard loads and voice-bridge controls cannot resurrect a deleted room.
Repeated launches do not extend an unexpired room. No media card appears in a
room until a shared source has content.

## Deployment boundary

This implementation uses one disk-backed app instance and one worker instance.
It is not a distributed queue or producer lease service. Deployment checks stop
if either app already has multiple machines; they do not delete machines or
volumes to conceal the issue. `--ha=false` prevents spare-machine creation and
`--strategy immediate` avoids overlapping old/new deployments. See the
[Fly deploy reference](https://fly.io/docs/flyctl/deploy/).

Do not scale either service to multiple instances without first introducing
shared persistence and a fenced producer lease. Restart/deploy can interrupt
playback and restart the current source from its beginning. Both app and worker
must be updated; cached old players must be reopened. Older generated HLS caches
are not part of the new producer and have not been deleted from production.

## Verification

Run `node --import tsx --test tests/*.test.ts tests/*.test.cjs`, `npm run typecheck`
and `npm run build`. ffmpeg is required for the real producer test.

The regression suite exercises concurrent source admission, stale requests,
deduplicated failures, retrying completion delivery, real paced fMP4 output,
buffer bounds, two shared queues, exactly-once advancement, rejected controls,
zero-volume persistence through polling/track changes, independent listeners,
Web Audio gain, bridge/unknown-source track gain, middleware and room expiry.

Local verification on 2026-09-11: 98 tests pass; TypeScript and production build
pass. The production-served player script also evaluates with zero Web Audio gain and no native mute/control attributes. Provider playback, audible output in Discord/mobile browsers and live
Fly deployment are not verified. Browser installation was blocked by the
execution environment's download connection. This change remains a draft and
has not been deployed; automated checks are not evidence of a live audio fix.
