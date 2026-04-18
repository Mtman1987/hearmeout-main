# Bot Integration - Quick Start

Get your Discord and Twitch bots running in 15 minutes!

## Prerequisites
- ✅ Discord bot token (from Discord Developer Portal)
- ✅ Twitch bot OAuth token
- ✅ A room ID from your HearMeOut app

---

## Step 1: Get Your Credentials (5 min)

### Discord
1. [Discord Developer Portal](https://discord.com/developers/applications)
2. Create app → Add bot → Copy **BOT TOKEN**
3. OAuth2 → URL Generator → scope: `bot` → Copy generated URL → Add to server
4. Enable Developer Mode in Discord (User Settings → Advanced)
5. Right-click channel → Copy **CHANNEL ID**

### Twitch
1. Create bot account on Twitch (e.g., "YourStreamer_Bot")
2. Go to [TMI OAuth Generator](https://twitchapps.com/tmi/)
3. Authorize bot account → Copy `oauth:` token
4. Note your **channel name** and **bot username**

---

## Step 2: Update Environment (3 min)

Edit `.env.local`:

```bash
# Discord
DISCORD_CLIENT_ID=your_app_id_here
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CHANNEL_ID=your_channel_id_here

# Twitch
TWITCH_BOT_USERNAME=yourstreamer_bot
TWITCH_BOT_OAUTH_TOKEN=oauth:your_token_here
TWITCH_CHANNEL_NAME=your_channel_name

# Room Config (from your app)
TARGET_ROOM_ID=your_room_id_from_app
```

**Save file** → Restart dev server

---

## Step 3: Test Discord Bot (3 min)

### Local Testing (if not publicly accessible)
Use [ngrok](https://ngrok.com/):
```bash
# In another terminal
ngrok http 3000
# Copy URL like https://abc123.ngrok.io
```

Update Discord Developer Portal:
- Interactions Endpoint URL: `https://abc123.ngrok.io/api/discord/interactions`

### Send Embed to Discord
In your app:
1. Create a room
2. Go to room settings
3. Click "Post Controls to Discord"
4. Check your Discord channel - you should see:

```
🎵 HearMeOut Player Controls
[🎵 Request] [⏯️ Play] [⏭️ Skip]
```

### Test Each Button
- **Request**: Click → Enter "Never Gonna Give You Up" → Song should appear in room
- **Play/Pause**: Click → Music in room should play/pause
- **Skip**: Click → Next song plays

---

## Step 4: Test Twitch Bot (2 min)

```bash
npm run twitch-bot
```

You should see:
```
* Connected to irc.chat.twitch.tv:6667
* Listening for !sr, !status, !np commands in #your_channel
* Adding songs to room: your_room_id
```

In Twitch chat, try:
```
!help
!sr rickroll
!np
!status
```

Bot should respond in chat.

---

## Step 5: Verify in Your App (2 min)

1. Open your HearMeOut app in browser
2. Join the room (become the DJ)
3. Try requesting a song from Discord
4. Song appears in playlist? ✅
5. Click play - music broadcasts to all users? ✅
6. Try Twitch commands - do they add songs? ✅

---

## Troubleshooting

### Discord buttons not responding
**Problem:** Click button, nothing happens

**Solutions:**
1. Check Discord interactions endpoint is set correctly
2. Verify bot is in server with message permissions
3. Restart dev server after .env changes
4. Check browser console for CORS errors
5. Check server terminal for error logs

### Twitch bot not connecting
**Problem:** `npm run twitch-bot` shows connection error

**Solutions:**
1. Verify `TWITCH_BOT_OAUTH_TOKEN` starts with `oauth:`
2. Token might be expired - regenerate it
3. Check bot username is correct
4. Check channel name is correct (lowercase, no #)

### Song not being added
**Problem:** Request successful but song doesn't appear

**Solutions:**
1. Check `TARGET_ROOM_ID` is correct
2. Verify room exists in your app
3. Check YouTube search - might not find the song
4. Try full YouTube URL instead of song name
5. Check server logs for error details

---

## What Works Now

✅ Discord "Request a Song" button with modal form
✅ Discord "Play/Pause" button for live control  
✅ Discord "Skip" button to skip tracks
✅ Twitch `!sr` command for song requests
✅ Twitch `!np` for now playing info
✅ Twitch `!status` for room status
✅ Twitch `!help` to show commands

---

## Next Steps

1. Add commands to OBS chat overlay: `!status`
2. Pin embed to Discord channel
3. Create chat commands for viewers
4. Deploy to production (no ngrok needed with public URL)
5. Monitor logs for any issues

---

## Production Deployment

Once working locally:

1. Deploy app to production (Vercel, etc.)
2. Update Discord interactions endpoint:
   ```
   https://your-production-domain.com/api/discord/interactions
   ```
3. Update `NEXT_PUBLIC_APP_URL` to production domain
4. Run `npm run twitch-bot` on production server
5. All bots should work immediately

---

## Commands Reference

### Discord (Click Buttons)
- 🎵 Request a Song → Opens modal
- ⏯️ Play/Pause → Toggle music
- ⏭️ Skip → Next track

### Twitch (Type in Chat)
```
!sr Lofi Hip Hop          → Add to queue
!sr [youtube-url]        → Add by URL
!np                       → Show current song
!status                   → Show room info
!help                     → Show commands
```

---

## Files You Modified

- ✅ `.env.local` - Added bot credentials
- ✅ `src/bots/discord-bot.ts` - 3-button embed
- ✅ `src/bots/twitch-bot.ts` - 4 commands
- ✅ `src/app/api/discord/interactions/route.ts` - Button handlers
- ✅ `src/lib/bot-actions.ts` - Control functions

---

**You're all set! 🎉 Your bots should be working now.**

Need help? Check `BOT_INTEGRATION_SETUP.md` for detailed troubleshooting.
