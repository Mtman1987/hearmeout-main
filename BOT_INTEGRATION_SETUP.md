# Complete Bot Integration Guide - Discord & Twitch

This guide walks you through setting up both Discord and Twitch bots to control your HearMeOut music room and take song requests.

---

## Table of Contents
1. [Discord Bot Setup](#discord-bot-setup)
2. [Twitch Bot Setup](#twitch-bot-setup)
3. [Environment Variables](#environment-variables)
4. [Features Overview](#features-overview)
5. [Testing](#testing)
6. [Troubleshooting](#troubleshooting)

---

## Discord Bot Setup

### Step 1: Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"** and give it a name (e.g., "HearMeOut Bot")
3. Go to the **"Bot"** tab and click **"Add Bot"**
4. Under **TOKEN**, click **"Copy"** to get your bot token
   - **Save this!** You'll need it as `DISCORD_BOT_TOKEN`

### Step 2: Configure Bot Permissions

1. Go to **"OAuth2"** → **"URL Generator"**
2. **Scopes:** Select `bot`
3. **Permissions:** Select:
   - `Send Messages`
   - `Embed Links`
   - `Read Messages/View Channels`
   - `Manage Messages`

4. Copy the generated URL at the bottom
5. Open it in your browser to add the bot to your server

### Step 3: Enable Interactions

Your bot needs to respond to button clicks and form submissions (interactions).

**Important:** Your Next.js app must be publicly accessible for Discord to send interaction webhooks.

1. Go back to Developer Portal → Your App
2. Go to **"General Information"**
3. Copy your **Application ID** (this is your `DISCORD_CLIENT_ID`)

### Step 4: Set Interaction Endpoint

1. In Developer Portal, go to **"Interactions Endpoint URL"**
2. Enter: `https://your-domain.com/api/discord/interactions`
3. Discord will send a PING request to verify - your endpoint handles this automatically

**Example:**
```
Production: https://hearmeout.example.com/api/discord/interactions
Local Dev: Use ngrok or similar to expose localhost
```

### Step 5: Discord Channel Setup

1. Find the Discord **Channel ID** where you want the music controls:
   - Enable **Developer Mode** in Discord (User Settings → Advanced → Developer Mode)
   - Right-click the channel → **Copy Channel ID**
   - Save this as `DISCORD_CHANNEL_ID`

---

## Twitch Bot Setup

### Step 1: Create Twitch Account for Bot

1. Create a new Twitch account (e.g., "yourstreamer_bot")
2. Sign in with this account

### Step 2: Get OAuth Token

1. Go to [Twitch OAuth Token Generator](https://twitchapps.com/tmi/) (or similar service)
2. Authorize your bot account
3. Copy the `oauth:xxxxx` token
4. Save as `TWITCH_BOT_OAUTH_TOKEN`

**Alternative - Manual OAuth:**
1. Go to [Twitch Developer Console](https://dev.twitch.tv/console/apps)
2. Create an Application
3. Get the **Client ID** and **Client Secret**
4. Use Twitch OAuth flow to get token with `chat:read` and `chat:write` scopes

### Step 3: Get Your Channel Name

- Your Twitch channel name (username) - save as `TWITCH_CHANNEL_NAME`
- Your bot username - save as `TWITCH_BOT_USERNAME`

---

## Environment Variables

Create or update your `.env.local` file with:

```bash
# Discord Bot
DISCORD_CLIENT_ID=your_discord_application_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CHANNEL_ID=your_channel_id_here
DISCORD_GUILD_ID=your_server_id_here

# Twitch Bot
TWITCH_BOT_USERNAME=your_bot_account_name
TWITCH_BOT_OAUTH_TOKEN=oauth:your_token_here
TWITCH_CHANNEL_NAME=your_channel_name

# Room Configuration
TARGET_ROOM_ID=the_room_id_to_control  # Room ID from your app

# Firebase (existing)
FIREBASE_API_KEY=your_firebase_key
# ... other Firebase vars

# LiveKit (existing)
NEXT_PUBLIC_LIVEKIT_URL=your_livekit_url
LIVEKIT_API_KEY=your_livekit_key
LIVEKIT_API_SECRET=your_livekit_secret

# App URL
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

---

## Features Overview

### Discord Bot Features

**Discord Embed Controls:**
```
┌─────────────────────────────┐
│  🎵 HearMeOut Player Controls │
├─────────────────────────────┤
│ • Request Songs              │
│ • Playback Controls         │
├─────────────────────────────┤
│ [🎵 Request] [⏯️ Play] [⏭️ Skip] │
└─────────────────────────────┘
```

**Available Buttons:**
1. **Request a Song** - Opens a modal for song requests
2. **Play/Pause** - Toggles playback
3. **Skip** - Skips to next track

**How Song Requests Work:**
1. User clicks "Request a Song" button
2. Modal appears asking for song name or YouTube URL
3. Bot searches YouTube and adds to playlist
4. Confirmation sent to user

**Posting Controls:**
In your app, go to room settings and click "Post Controls to Discord" to send the embed.

---

### Twitch Bot Features

**Available Commands:**
```
!sr [song/URL]     → Request a song
                      Example: !sr Never Gonna Give You Up
                      Example: !sr https://youtube.com/watch?v=...

!np                → Show now playing info
                      Shows: Current song, artist, queue length

!status            → Show room status
                      Shows: DJ name, play state, queue length

!help              → Show all commands
!commands          → Show all commands
```

**Response Examples:**
```
User: !sr lofi hip hop
Bot: ✅ @username Queued up: "Lofi Hip Hop Radio"

User: !np
Bot: ▶️ Playing: "Lofi Hip Hop Radio" by Chilled Cow (42 songs in queue)

User: !status
Bot: 🎵 DJ: StreamerName | ▶️ Playing | Queue: 42 songs
```

---

## Testing

### Test Discord Bot

1. **Start Your App:**
   ```bash
   npm run dev
   ```

2. **Make Room Public:**
   - Create a room in your app
   - Copy the Room ID
   - Set `TARGET_ROOM_ID` in `.env.local`

3. **Post Controls:**
   - Go to room settings
   - Click "Post Controls to Discord"
   - Check your Discord channel

4. **Test Request Button:**
   - Click "🎵 Request a Song" in Discord
   - Enter a song name
   - Check if it appears in your room's playlist

5. **Test Play/Pause:**
   - Click "⏯️ Play/Pause" button
   - Check room UI - music should play/pause
   - Check console for "Music track published successfully"

6. **Test Skip:**
   - Click "⏭️ Skip" button
   - Next song should start

### Test Twitch Bot

1. **Start Bot:**
   ```bash
   npm run twitch-bot
   ```

   You should see:
   ```
   * Connected to irc.chat.twitch.tv:6667
   * Listening for !sr, !status, !np commands in #your_channel_name
   * Adding songs to room: your_room_id
   ```

2. **Test in Twitch Chat:**
   ```
   Type: !help
   Bot should respond with all available commands
   
   Type: !sr rickroll
   Bot should respond with success/error
   
   Type: !np
   Bot should show current track info
   ```

3. **Verify in App:**
   - Check if song appears in playlist
   - Check DJ console shows the song

---

## Troubleshooting

### Discord Issues

**"Bot not configured (missing Room ID)"**
- Check `TARGET_ROOM_ID` is set in `.env.local`
- Restart dev server after updating .env

**Discord buttons not responding**
- Verify `NEXT_PUBLIC_APP_URL` is correct (must be publicly accessible)
- Check Discord Developer Portal → Interactions Endpoint URL is set
- Look for errors in server logs
- Ensure bot has permission to send messages

**Song request returns error**
- Check Firebase Firestore is accessible
- Verify room exists with that ID
- Check YouTube API rate limits
- Review server logs for error details

**Discord embed not posting**
- Verify bot is in the server
- Check bot has "Send Messages" permission
- Verify `DISCORD_CHANNEL_ID` is correct
- Check bot token in `DISCORD_BOT_TOKEN`

### Twitch Issues

**"Failed to connect to Twitch"**
- Verify `TWITCH_BOT_OAUTH_TOKEN` starts with `oauth:`
- Check token hasn't expired
- Verify bot account isn't banned

**Commands not responding**
- Check bot is in the channel (`/mod botname`)
- Verify `TWITCH_CHANNEL_NAME` matches your channel
- Check bot is running (`npm run twitch-bot`)
- Verify TARGET_ROOM_ID is correct

**"I couldn't find a song matching..."**
- Song might not exist on YouTube
- Try full YouTube URL instead of song name
- Check for typos in song name
- Try a different song

**Permissions Issues**
- Make sure your Twitch OAuth token has:
  - `chat:read` scope
  - `chat:write` scope

---

## Advanced Configuration

### Rate Limiting (Optional)

Add rate limiting to prevent spam:

```typescript
// In twitch-bot.ts or discord interactions
const userCooldowns = new Map<string, number>();
const COOLDOWN_MS = 5000; // 5 seconds between commands per user

function checkCooldown(userId: string): boolean {
  const now = Date.now();
  const cooldownTime = userCooldowns.get(userId);
  
  if (cooldownTime && now < cooldownTime) {
    return false;
  }
  
  userCooldowns.set(userId, now + COOLDOWN_MS);
  return true;
}
```

### Custom Responses

Edit responses in:
- Discord: `src/app/api/discord/interactions/route.ts`
- Twitch: `src/bots/twitch-bot.ts`

### Logging

Enable detailed logging for debugging:

```typescript
// In bot files
console.log(`[DISCORD] Interaction from ${member.user.username}: ${custom_id}`);
console.log(`[TWITCH] Message from ${requester}: ${message}`);
```

---

## Security Best Practices

1. **Never commit bot tokens to git:**
   - Use `.env.local` (already in `.gitignore`)
   - Rotate tokens regularly

2. **Validate Discord Signatures:**
   - Uncomment signature verification in `/api/discord/interactions/route.ts`
   - Follow Discord security docs

3. **Rate Limit Requests:**
   - Implement cooldowns
   - Prevent spam/abuse

4. **Use HTTPS Only:**
   - Discord requires HTTPS for interaction endpoint
   - Twitch chat is encrypted

---

## File Structure

```
src/
├── bots/
│   ├── discord-bot.ts       ← sendControlEmbed()
│   └── twitch-bot.ts        ← Twitch command handler
├── lib/
│   └── bot-actions.ts       ← Core functions (addSong, skipTrack, etc)
└── app/
    └── api/
        ├── discord/
        │   └── interactions/route.ts  ← Discord interaction handler
        └── actions.ts        ← postToDiscord()
```

---

## What's Working Now

✅ Discord song requests (modal form)
✅ Discord play/pause control
✅ Discord skip control
✅ Twitch song requests (!sr)
✅ Twitch now playing (!np)
✅ Twitch status (!status)
✅ Automatic requester names tagged

---

## Next Steps

1. Set all environment variables
2. Test Discord bot locally with ngrok
3. Test Twitch bot in your channel
4. Monitor logs for errors
5. Deploy to production with HTTPS

---

## Support

**Discord Issues?**
- Check Developer Portal settings
- Verify bot permissions
- Review server logs

**Twitch Issues?**
- Check TMI connection logs
- Verify OAuth token validity
- Run `npm run twitch-bot` with logging

**General Questions?**
- Review integration guide
- Check bot-actions.ts for available functions
- Test in development first

