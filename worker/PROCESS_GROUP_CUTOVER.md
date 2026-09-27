# Lounge worker cutover

The configuration in `fly.toml` assigns one shared CPU per Machine in three
process groups of `hmo-dj-worker`:

| Process | Public service | Lifetime | Work |
| --- | --- | --- | --- |
| `dj` | 443 | Stop when idle | HearMeOut room DJ, voice and extraction |
| `lounge` | 4444 | Always on | Lounge movie HLS and music capture |
| `spotlight` | 4445 | Always on | Twitch capture and click recovery |

The proposed `spmt.live` Spotlight viewer fetches video from the Spotlight
Machine on port 4445. The proposed HearMeOut Lounge viewer URLs fetch movie
and music bytes from port 4444. Neither change is live yet.

## Blocker before deploying

The Lounge selections still live in HearMeOut's `/data/watch-state.json`.
StreamWeaver bot actions and HearMeOut's Twitch bot write those selections to
the HearMeOut API. The Lounge Machine reads
`/api/lounge-media/program` and asks HearMeOut's
`/api/watch/xtream/source/...` for a movie URL. Its music renderer opens a
HearMeOut overlay page. This must be migrated to Lounge-owned state and
source resolution before calling the services independent. Moving this file
to another Machine without migrating the writers would lose queue updates.

The old `hmo-lounge-worker` volume contains movie HLS cache; it is disposable,
but check whether any other files on that volume must be retained before
removing it. The new `lounge_data` volume needs to exist in `iad` before
deploy. Keep the current player URLs in production until the worker feed and
autoplay are verified at the new port.

## Cutover checks

1. Move Lounge movie and music queue state, bot writers, and Xtream source
   resolution to the Lounge process. Verify HearMeOut is no longer queried
   by the Lounge worker or its viewer for each playback cycle.
2. Create the `lounge_data` volume in `iad`, deploy the worker with one Machine
   per process (`--ha=false`), and verify `/health` on each assigned port.
   Explicitly scale down the existing stopped Spotlight replica. Check that
   `dj` stops with zero DJ users while ports 4444 and 4445 stay healthy.
3. Verify the movie and music videos start with sound in the actual Lounge
   browser source; verify source feed bytes come directly from port 4444.
   Verify Spotlight capture keeps playing and recovers from a Twitch click
   failure while its viewer reads port 4445.
4. Switch `spmt.live` to the new viewer. Check the Spotlight BRB, volume and
   health signals. Retire `hmo-lounge-worker` and `spmt-player-lab` only after
   confirming they have no remaining live traffic or persistent data to keep.

If any cutover check fails, restore the existing viewer URLs and keep the
older Lounge worker running while repairing the new path.
