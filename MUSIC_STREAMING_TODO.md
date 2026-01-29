# Music Streaming TODO

## Current Issue
- YouTube iframe embeds work but can't be captured for LiveKit streaming due to cross-origin restrictions
- Piped instances are unreliable (all down currently)
- yt-dlp requires installation and doesn't work in serverless Firebase App Hosting

## Alternatives to Try

### 1. Direct YouTube URLs (Simplest)
- Store direct YouTube URLs in playlist
- Each user plays YouTube embed locally (no sync)
- Pros: Works immediately, no server needed
- Cons: Not synced between users

### 2. Invidious API
- Similar to Piped but different instances
- Try: https://invidious.io, https://yewtu.be
- Returns direct audio stream URLs
- Pros: No download needed
- Cons: Also unreliable

### 3. Firebase Storage + Cloud Function
- Cloud Function downloads with yt-dlp
- Uploads to Storage bucket
- Returns signed URL
- Pros: Reliable, cached
- Cons: Requires Cloud Function setup, costs money

### 4. Self-hosted yt-dlp server
- Run separate server with yt-dlp installed
- API endpoint returns direct audio URL
- Pros: Full control
- Cons: Need to maintain server

### 5. Use Spotify/SoundCloud embeds instead
- Many services allow embedding
- Some allow audio capture
- Pros: More reliable than YouTube
- Cons: Limited catalog

## Recommended Next Step
Try Invidious instances first, then set up Cloud Function if that fails.
