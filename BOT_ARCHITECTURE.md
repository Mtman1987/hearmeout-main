# Bot Integration Architecture

Visual guide to how Discord and Twitch bots integrate with your HearMeOut app.

---

## System Overview

```
                    ┌─────────────────────────────────────────┐
                    │   HEARMEOUT WEB APP                     │
                    │   (Next.js + React + Firebase)          │
                    │                                         │
                    │  ┌─────────────────────────────────┐   │
                    │  │  Room State (Firestore)         │   │
                    │  │  - playlist[]                   │   │
                    │  │  - currentTrackId               │   │
                    │  │  - isPlaying                    │   │
                    │  │  - djId                         │   │
                    │  └─────────────────────────────────┘   │
                    │              ▲                         │
                    │              │ (real-time updates)     │
                    │              │                         │
                    └──────────────┼─────────────────────────┘
                                   │
                  ┌────────────────┼────────────────┐
                  │                │                │
                  ▼                ▼                ▼
          ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
          │  DISCORD BOT │  │  TWITCH BOT  │  │   WEB APP UI │
          │              │  │              │  │              │
          │ • Buttons    │  │ • !sr        │  │ • DJ Console │
          │ • Modals     │  │ • !np        │  │ • WebRTC     │
          │ • Embed      │  │ • !status    │  │ • Player     │
          └──────────────┘  └──────────────┘  └──────────────┘
                  │                │                │
                  └────────────────┼────────────────┘
                                   │
                                   ▼
                          ┌──────────────────────────┐
                          │  bot-actions.ts          │
                          │                          │
                          │  • addSongToPlaylist()   │
                          │  • skipTrack()           │
                          │  • updateRoomPlayState() │
                          │  • getRoomState()        │
                          └──────────────────────────┘
```

---

## Discord Bot Flow

### 1. Song Request

```
User in Discord
     ↓
Clicks [🎵 Request] button
     ↓
/api/discord/interactions endpoint
     ↓
Responds with Modal ("Enter song name")
     ↓
User types "Lofi Hip Hop" in modal
     ↓
Modal submission to /api/discord/interactions
     ↓
Calls addSongToPlaylist(query, roomId, requester)
     ↓
addSongToPlaylist():
  • YouTube.search("Lofi Hip Hop")
  • Creates PlaylistItem object
  • Updates Firestore room.playlist array
  • Sets isPlaying=true if first song
     ↓
Firestore triggers real-time update
     ↓
React component sees new song
     ↓
MusicStreamer component publishes to WebRTC
     ↓
All room participants hear music
     ↓
Discord user sees: ✅ "Queued up: Lofi Hip Hop"
```

### 2. Play/Pause Control

```
User in Discord
     ↓
Clicks [⏯️ Play] button
     ↓
/api/discord/interactions endpoint
     ↓
Calls getRoomState(roomId)
     ↓
Gets current isPlaying value
     ↓
Toggles: isPlaying = !isPlaying
     ↓
Updates Firestore room.isPlaying
     ↓
Firestore triggers real-time update
     ↓
MusicStreamer sees isPlaying changed
     ↓
Starts/stops publishing audio track
     ↓
All users hear music play/pause
     ↓
Discord button updates with new state
```

### 3. Skip Track

```
User in Discord
     ↓
Clicks [⏭️ Skip] button
     ↓
/api/discord/interactions endpoint
     ↓
Calls skipTrack(roomId)
     ↓
skipTrack():
  • Get current playlist from Firestore
  • Find current track index
  • Calculate next index: (current + 1) % length
  • Update Firestore:
    - currentTrackId = nextTrack.id
    - isPlaying = true
     ↓
Firestore triggers real-time update
     ↓
React component sees currentTrackId changed
     ↓
MusicStreamer:
  • Unpublishes old track
  • Fetches new audio URL
  • Publishes new track
     ↓
All users hear new song
     ↓
Discord user gets: ✅ "Skipped to next track"
```

---

## Twitch Bot Flow

### 1. Chat Command Processing

```
Viewer in Twitch chat
     ↓
Types: "!sr rickroll"
     ↓
TMI.js listener receives message
     ↓
onMessageHandler() function
     ↓
Checks if message starts with "!sr"
     ↓
Extracts query: "rickroll"
     ↓
Gets requester name from context
     ↓
Calls addSongToPlaylist(query, roomId, requester)
     ↓
[Same as Discord song request flow]
     ↓
Bot responds in chat: ✅ "@viewer Queued up:..."
```

### 2. Now Playing (!np)

```
Viewer in Twitch chat
     ↓
Types: "!np"
     ↓
Calls getRoomState(roomId)
     ↓
getRoomState():
  • Fetch room doc from Firestore
  • Get currentTrackId
  • Find matching track in playlist
  • Return: {
      isPlaying: true/false,
      currentTrack: {...},
      playlistLength: 42,
      djDisplayName: "StreamerName"
    }
     ↓
Bot responds: "▶️ Playing: Song Name by Artist (42 songs in queue)"
```

### 3. Status (!status)

```
Similar to !np, but shows:
"🎵 DJ: StreamerName | ▶️ Playing | Queue: 42 songs"
```

---

## Real-Time Sync Flow

```
Firestore Room Document
     │
     ├─ playlist: PlaylistItem[]
     ├─ currentTrackId: string
     ├─ isPlaying: boolean
     ├─ djId: string
     └─ djDisplayName: string
          │
          │ Real-time listener
          │ (onSnapshot)
          │
          ├─→ Discord Bot → Updates UI state
          ├─→ Twitch Bot → Updates cached state
          └─→ Web App → React components re-render
               │
               └─→ MusicStreamer component
                   │
                   ├─→ Detects track change
                   ├─→ Fetches audio URL
                   ├─→ Creates MediaStreamTrack
                   └─→ Publishes to LiveKit/WebRTC
                        │
                        └─→ All participants hear audio
```

---

## File Interactions

```
User Action (Discord/Twitch)
         │
         ▼
Input Handler
• POST /api/discord/interactions (Discord)
• onMessageHandler() (Twitch)
         │
         ▼
bot-actions.ts
• addSongToPlaylist()
• skipTrack()
• updateRoomPlayState()
• getRoomState()
         │
         ▼
Firebase Admin SDK
         │
         ├─→ Read: room document
         ├─→ Write: playlist array
         └─→ Write: state flags
         │
         ▼
Firestore Database
(room/{roomId})
         │
         ▼
Firebase Real-time Listener
(useDoc hook in React)
         │
         ▼
React Components
• room page
• MusicStreamer
• MusicPlayerCard
         │
         ▼
LiveKit WebRTC
         │
         ▼
All Participants Hear Music
```

---

## State Machine: Room Playback

```
┌─────────────────────────────────────────────────────┐
│  Firestore: room/{roomId}                          │
│                                                     │
│  isPlaying: false                                  │
│  currentTrackId: null                              │
│  playlist: []                                      │
└─────────────────────────────────────────────────────┘
          │
          │ Song requested (!sr or Discord button)
          ▼
┌─────────────────────────────────────────────────────┐
│  addSongToPlaylist()                                │
│                                                     │
│  Update:                                            │
│  - Add to playlist array                           │
│  - If empty: set currentTrackId = first.id         │
│  - If empty: set isPlaying = true                  │
└─────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────┐
│  isPlaying: true                                   │
│  currentTrackId: "videoId123"                      │
│  playlist: [Song1, Song2, ...]                     │
└─────────────────────────────────────────────────────┘
          │
   ┌──────┴──────┬──────────┐
   │             │          │
   │             │          │
   ▼             ▼          ▼
[Skip]    [Play/Pause]   [Next song]
   │             │          │
   │      Set isPlaying:    │
   │      false/true        │
   │             │          │
   ▼             ▼          ▼
Update       Update       Update
Track ID     Flag Only    Track ID
   │             │          │
   └──────┬──────┴──────┬───┘
          │
          ▼
┌─────────────────────────────────────────────────────┐
│  MusicStreamer detects change                      │
│  Fetches new audio URL                             │
│  Publishes to WebRTC                               │
│  All users hear new state                          │
└─────────────────────────────────────────────────────┘
```

---

## Latency Breakdown

| Action | Component | Latency | Total |
|--------|-----------|---------|-------|
| Discord button click | Network | 50ms | 50ms |
| → Send to server | Server | 10ms | 60ms |
| → Firestore update | Firebase | 100ms | 160ms |
| → Real-time listener | Firebase | 100ms | 260ms |
| → React re-render | Browser | 50ms | 310ms |
| → WebRTC publish | LiveKit | 200ms | **510ms** |
| **Total Discord button** | | | **~500ms** |
| | | | |
| Twitch command | Network | 100ms | 100ms |
| → Bot receives | TMI | 50ms | 150ms |
| → YouTube search | YouTube API | 1000ms | 1150ms |
| → Firestore update | Firebase | 100ms | 1250ms |
| → Real-time listener | Firebase | 100ms | 1350ms |
| → React re-render | Browser | 50ms | 1400ms |
| → WebRTC publish | LiveKit | 200ms | **1600ms** |
| **Total Twitch request** | | | **~1.5-2s** |

---

## Error Handling Flow

```
Any operation fails
     │
     ├─ Discord: Set response with ❌ error message
     ├─ Twitch: Reply in chat with error
     └─ Web: Show toast notification
          │
          ▼
Log to console with details
     │
     ├─ YouTube not found
     ├─ Room ID invalid  
     ├─ Firestore error
     ├─ WebRTC publish failed
     └─ Audio URL resolution failed
          │
          ▼
User sees clear error message
     │
     └─ Can retry or try different song
```

---

## Data Types

### PlaylistItem
```typescript
{
  id: string;              // YouTube video ID
  title: string;           // Song title
  artist: string;          // Channel/Artist name
  url: string;             // YouTube URL
  artId: string;           // Album art reference
  duration: number;        // Duration in seconds
}
```

### Room Document (Firestore)
```typescript
{
  id: string;
  name: string;
  ownerId: string;
  djId: string;
  djDisplayName: string;
  playlist: PlaylistItem[];
  currentTrackId: string;
  isPlaying: boolean;
}
```

### RoomState (Returned by getRoomState)
```typescript
{
  isPlaying: boolean;
  currentTrack: PlaylistItem | null;
  playlistLength: number;
  djDisplayName: string;
}
```

---

## Permissions & Access

```
Discord Bot
├─ Read: Interactions from Discord
├─ Write: Messages to channel
└─ Access: Specific channel only

Twitch Bot
├─ Read: Chat messages
├─ Write: Chat messages
└─ Access: Single channel only

Web App
├─ Read: All rooms & playlists
├─ Write: Only DJ can modify room
└─ Access: Rooms user is in

Firestore
├─ Read: bot-actions.ts (server)
├─ Write: bot-actions.ts (server)
└─ Access: Via Firebase Admin SDK
```

---

## Deployment Checklist

- [ ] Discord interactions endpoint set to production URL
- [ ] HTTPS certificate valid (required by Discord)
- [ ] All environment variables configured
- [ ] Twitch bot running on production server
- [ ] Firestore security rules allow bot access
- [ ] LiveKit server accessible from bot
- [ ] Discord bot has required permissions
- [ ] Twitch bot moderator in channel
- [ ] Monitor bot logs for errors
- [ ] Test all features in production

---

**This architecture ensures:**
✅ Real-time sync across all platforms
✅ Minimal latency for user actions
✅ Reliable error handling
✅ Scalable design
✅ Easy to debug and maintain
