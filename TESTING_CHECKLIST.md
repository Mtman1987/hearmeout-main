# Testing Checklist

## Prerequisites
- [ ] Discord bot token added to `apphosting.yaml`
- [ ] Twitch bot username and OAuth token added to `apphosting.yaml`
- [ ] Twitch bot running separately: `npm run twitch-bot`

## Core Features to Test

### 1. Authentication
- [ ] Discord OAuth login works
- [ ] Twitch OAuth login works
- [ ] User profile displays correctly

### 2. Room Management
- [ ] Create new room
- [ ] Join existing room
- [ ] Delete room (owner only)
- [ ] Auto-join voice chat on room entry

### 3. Music Streaming
- [ ] Search and add songs to playlist
- [ ] Play/pause controls work
- [ ] Skip to next song
- [ ] Audio streams to all participants via LiveKit
- [ ] YouTube audio resolution with fallback

### 4. Voice Chat
- [ ] Microphone toggle works
- [ ] Audio from other users is heard
- [ ] LiveKit connection stable

### 5. Discord Bot Integration
- [ ] Set Discord server ID in user card menu
- [ ] Post control embed to Discord channel
- [ ] Discord buttons work (Request Song, Play/Pause, Skip)
- [ ] Song request modal opens and submits
- [ ] Commands execute correctly

### 6. Twitch Bot Integration
- [ ] Set Twitch channel in user card menu
- [ ] Bot joins channel within 30 seconds
- [ ] `!sr [song]` command adds to playlist
- [ ] `!np` shows now playing
- [ ] `!status` shows room status
- [ ] `!help` lists commands

### 7. Chat Widget (Popout)
- [ ] Open chat widget from room header
- [ ] Discord channels load correctly
- [ ] Discord messages poll every 3 seconds
- [ ] Send Discord messages
- [ ] Twitch chat iframe loads
- [ ] Switch between tabbed/split-v/split-h view modes
- [ ] Widget position persists after refresh
- [ ] Widget size persists after refresh
- [ ] Drag and resize widget

## Known Limitations
- Voice room widget removed (requires LiveKit context)
- Firestore security rules not deployed (deferred to production)
- Firestore indexes not created (auto-suggested when needed)

## Environment Variables Required
```yaml
DISCORD_BOT_TOKEN=your_actual_bot_token
TWITCH_BOT_USERNAME=your_bot_username
TWITCH_BOT_OAUTH_TOKEN=oauth:your_oauth_token
```

## Quick Test Flow
1. Deploy to Firebase App Hosting
2. Login with Discord or Twitch
3. Create a room
4. Open user card → Set Discord server ID
5. Open user card → Set Twitch channel
6. Click "Discord Bot" button → Post embed to channel
7. Start Twitch bot: `npm run twitch-bot`
8. Add songs to playlist and test playback
9. Open chat widget and verify Discord/Twitch integration
10. Test bot commands from Discord and Twitch
11. Refresh page and verify widget positions persist
12. Test OBS overlay: `/obs/chat/ROOM_ID?userId=YOUR_USER_ID&opacity=95`
