# Live HearMeOut production authority

Effective 2026-09-23, **Mtman1987/hearmeout-main is the only production HearMeOut authority**.

## Hard rules

1. Production HearMeOut state, queues, rooms, playback, Twitch commands, Discord Activity, OBS/lounge playback, and worker control are owned by `hearmeout-main`.
2. The permanent SpaceMountain Lounge room is `system-spacemountainlive-lounge`. Its mixed music/movie program uses `SPACEMOUNTAIN_LOUNGE_SESSION_ID`.
3. SpaceMountain Twitch media commands (`!sr`, `!wr`, `!radio`, now-playing, and playback controls) must execute directly against Live HMO. They must never relay through ApolloStation or a Sprite URL.
4. Production HMO configuration must not contain `APOLLO_LOUNGE_ORIGIN`, `APOLLO_LOUNGE_TWITCH_CHANNEL`, `web-terminal-bvesa.sprites.app`, or another Apollo HMO fallback.
5. Live HMO must not expose a bridge whose purpose is to let Apollo read or control the Lounge queue. The retired `/api/internal/lounge/media` route must remain absent.
6. ApolloStation's HearMeOut implementation is non-production only. It is not a fallback, mirror, queue authority, command destination, or public production route.
7. A future HMO replacement requires an explicit owner-approved atomic cutover. The new authority must replace Live HMO in one cutover; running both as competing authorities is forbidden.

## Regression rule

CI tests must fail if an Apollo Lounge relay, Apollo HMO production origin, or the retired internal Lounge bridge is reintroduced into the Live HMO production path.
