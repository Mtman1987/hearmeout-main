# HearMeOut - Live Music Streaming Platform

A Next.js application for live music streaming with voice chat, playlist management, and integrated Discord/Twitch bots.

## Features

- **Live Voice Chat**: Real-time audio streaming using LiveKit
- **Music Streaming**: DJ controls with YouTube integration
- **Discord Integration**: Bot controls and chat widget
- **Twitch Integration**: Bot commands and embedded chat
- **Room Management**: Create, join, and manage music rooms
- **OAuth Authentication**: Discord and Twitch login
- **OBS Overlay**: Stream overlay showing users, voice activity, and now playing

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Bot Integration

### Discord Bot Setup

1. **Create Discord Bot**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create application → Add bot → Copy bot token
   - OAuth2 → URL Generator → Select `bot` scope
   - Bot permissions: Send Messages, Embed Links, Read Messages
   - Add bot to your server

2. **Configure User Settings**
   - In a room, open your user card dropdown menu
   - Click "Discord Bot"
   - Enter your Discord Server ID (Enable Developer Mode → Right-click server → Copy Server ID)
   - Save

3. **Features**
   - **Chat Widget**: View and send Discord messages in-app (polls every 3 seconds)
   - **Control Embed**: Post music controls to Discord channels
   - **Commands**: Request songs, play/pause, skip via Discord buttons

### Twitch Bot Setup

1. **Create Twitch Bot Account**
   - Create new Twitch account (e.g., "yourname_bot")
   - Go to [TMI OAuth Generator](https://twitchapps.com/tmi/)
   - Authorize bot account → Copy OAuth token

2. **Configure User Settings**
   - In a room, open your user card dropdown menu
   - Click "Twitch Bot"
   - Enter your Twitch channel name
   - Save (bot joins within 30 seconds)

3. **Run Twitch Bot**
   ```bash
   npm run twitch-bot
   ```

4. **Features**
   - **Embedded Chat**: Full Twitch chat in chat widget (native iframe)
   - **Commands**:
     - `!sr [song/URL]` - Request a song
     - `!np` - Show now playing
     - `!status` - Show room status
     - `!help` - Show commands

### Environment Variables

Add to `apphosting.yaml` or `.env.local`:

```yaml
# Discord
NEXT_PUBLIC_DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_BOT_TOKEN=your_discord_bot_token

# Twitch
NEXT_PUBLIC_TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_client_secret
TWITCH_BOT_USERNAME=your_bot_username
TWITCH_BOT_OAUTH_TOKEN=oauth:your_oauth_token

# LiveKit
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
NEXT_PUBLIC_LIVEKIT_URL=wss://your-livekit-url

# App
NEXT_PUBLIC_BASE_URL=https://your-deployment-url
```

## Architecture

### Per-User Bot Configuration
- Each user configures their own Discord server and Twitch channel
- Settings stored in Firestore: `rooms/{roomId}/users/{userId}`
- Discord bot fetches channels from user's configured server
- Twitch bot dynamically joins all configured channels

### Chat Widget
- **Discord**: Polls Discord API every 3 seconds for messages
- **Twitch**: Embedded iframe with native Twitch chat
- **View Modes**: Tabbed, Split Vertical, Split Horizontal

### Music Streaming
- Uses Web Audio API to capture `<audio>` element output
- Publishes audio track to LiveKit for real-time broadcasting
- Automatic retry with fallback for YouTube audio resolution

### API Endpoints
- `GET /api/discord/channels?guildId={id}` - Fetch Discord channels
- `GET /api/discord/messages?channelId={id}` - Fetch Discord messages
- `POST /api/discord/send` - Send Discord message
- `POST /api/discord/interactions` - Handle Discord button interactions
- `GET /api/youtube-audio?videoId={id}` - Resolve YouTube audio stream

## OBS Integration

Stream overlay showing room participants with voice activity indicators and currently playing song.

### Setup

1. In OBS, add **Browser Source**
2. **URL**: `https://your-deployment-url/overlay/ROOM_ID?userId=YOUR_USER_ID`
3. **Width**: 1920, **Height**: 1080 (or your stream resolution)
4. **FPS**: 30

### Stream Mode

**Enable Stream Mode** in your user card dropdown (3 dots menu) to:
- Disable audio in main room page
- Enable audio in overlay (OBS captures all audio)
- Simplify audio routing - no virtual cables needed!

**How to use:**
1. Open main room page, become DJ, set up music
2. Enable Stream Mode in your user card menu
3. OBS overlay now outputs all audio (music + voices)
4. Close main room page or keep open for controls

**Get your User ID:** Check browser console or Firestore

### Features

- **Now Playing**: Song title, artist, and thumbnail
- **User List**: All participants in the room
- **Voice Activity**: Users light up green when speaking
- **DJ Indicator**: Shows who is currently DJing
- **Adjustable Opacity**: Change `opacity` parameter (0-100)

### URL Parameters

- `opacity` - Background opacity 0-100 (default: 95)

## Database Structure

### Firestore Collections
```
users/{userId}
  - uid, email, displayName, photoURL
  - preferences, stats

rooms/{roomId}
  - name, ownerId, isPublic
  - playlist[], currentTrackId, isPlaying
  - djId, djDisplayName
  - metadata (viewCount, totalSongsPlayed)
  
  /users/{userId}
    - displayName, photoURL, joinedAt
    - discordGuildId, twitchChannel
    - connectionState, isMuted
```

### Security Rules
Deploy with: `firebase deploy --only firestore:rules`

See `firestore.rules` for complete production rules.

## Deployment

### Firebase App Hosting

```bash
npm run build
```

Deploy via Firebase Studio or CLI.

### Twitch Bot (Separate Server)

Run on VM or server:
```bash
npm run twitch-bot
```

Bot syncs channels from Firestore every 30 seconds.

### Production Checklist

- [ ] Set all environment variables in `apphosting.yaml`
- [ ] Deploy Firestore security rules
- [ ] Set up automated backups
- [ ] Update Discord interactions endpoint URL
- [ ] Deploy Twitch bot to separate server
- [ ] Test all features in production

## Documentation

- `BOT_SETUP_CHECKLIST.md` - Complete setup checklist
- `QUICK_START_BOTS.md` - 15-minute quick start guide
- `TODO.md` - Remaining work and priorities

## Tech Stack

- **Framework**: Next.js 15
- **Auth**: Firebase Authentication
- **Database**: Cloud Firestore
- **Voice**: LiveKit
- **Styling**: Tailwind CSS + shadcn/ui
- **Music**: YouTube Search API + Piped instances
- **Bots**: Discord API, Twitch TMI

## Troubleshooting

### Audio Not Playing
- Check browser console for errors
- Verify LiveKit connection
- Try different YouTube video
- Check audio permissions

### Discord Bot Not Responding
- Verify bot token is correct
- Check bot has proper permissions
- Ensure interactions endpoint is set correctly

### Twitch Bot Not Connecting
- Verify OAuth token starts with `oauth:`
- Check bot username is correct
- Ensure bot is not banned from channel

## License

MIT
