# SpaceMountainLive Lounge media

The 24-Hour Lounge plays from the always-on HearMeOut worker and serves passive viewers through `hearmeout-main.fly.dev`. The music and movie queues are separate, and StreamWeaver is the sole Twitch command handler for `#spacemountainlive`.

Do not route the Lounge or Spotlight through ApolloStation or Sprite. Do not add a second viewer player that loads the media URL, seeks, or synchronizes a timeline. The viewer receives current output frames from the persistent source. Do not use LiveKit for this media.
