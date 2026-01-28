# Bot Integration Checklist

Complete this checklist to get your bots running.

---

## Step 1: Get Discord Bot Credentials

- [ ] Go to [Discord Developer Portal](https://discord.com/developers/applications)
- [ ] Create new Application
- [ ] Go to "Bot" tab → Click "Add Bot"
- [ ] Under TOKEN, click "Copy"
  - Save as: `DISCORD_BOT_TOKEN`
- [ ] Go to "OAuth2" → "URL Generator"
- [ ] Select scopes: `bot`
- [ ] Select permissions:
  - [ ] Send Messages
  - [ ] Embed Links  
  - [ ] Read Messages/View Channels
- [ ] Copy generated URL
- [ ] Open in browser to add bot to server
- [ ] Copy **Application ID**
  - Save as: `DISCORD_CLIENT_ID`
- [ ] Find Discord channel ID:
  - [ ] Enable Developer Mode (User Settings → Advanced)
  - [ ] Right-click channel → Copy ID
  - Save as: `DISCORD_CHANNEL_ID`

**Checklist for Discord setup:**
- [x] `DISCORD_CLIENT_ID` obtained
- [x] `DISCORD_BOT_TOKEN` obtained
- [x] `DISCORD_CHANNEL_ID` obtained
- [x] Bot added to server

---

## Step 2: Get Twitch Bot Credentials

- [ ] Create new Twitch account for bot (e.g., "yourname_bot")
- [ ] Go to [TMI OAuth Generator](https://twitchapps.com/tmi/)
- [ ] Authorize your bot account
- [ ] Copy token (starts with `oauth:`)
  - Save as: `TWITCH_BOT_OAUTH_TOKEN`
- [ ] Note your bot username (the Twitch name)
  - Save as: `TWITCH_BOT_USERNAME`
- [ ] Note your channel name (your main Twitch username)
  - Save as: `TWITCH_CHANNEL_NAME`

**Checklist for Twitch setup:**
- [x] `TWITCH_BOT_USERNAME` obtained
- [x] `TWITCH_BOT_OAUTH_TOKEN` obtained (with `oauth:` prefix)
- [x] `TWITCH_CHANNEL_NAME` obtained

---

## Step 3: Configure Environment Variables

Edit `.env.local`:

```bash
# DISCORD
DISCORD_CLIENT_ID=your_value_here
DISCORD_BOT_TOKEN=your_value_here
DISCORD_CHANNEL_ID=your_value_here

# TWITCH
TWITCH_BOT_USERNAME=your_value_here
TWITCH_BOT_OAUTH_TOKEN=your_value_here
TWITCH_CHANNEL_NAME=your_value_here

# BOT CONTROL
TARGET_ROOM_ID=get_from_your_app

# Other existing variables...
NEXT_PUBLIC_APP_URL=http://localhost:3000
# ... rest of your config
```

- [ ] DISCORD_CLIENT_ID added
- [ ] DISCORD_BOT_TOKEN added
- [ ] DISCORD_CHANNEL_ID added
- [ ] TWITCH_BOT_USERNAME added
- [ ] TWITCH_BOT_OAUTH_TOKEN added (with `oauth:` prefix)
- [ ] TWITCH_CHANNEL_NAME added
- [ ] TARGET_ROOM_ID added (get from your app)
- [ ] File saved
- [ ] Dev server restarted

---

## Step 4: Test Discord Bot (Local)

### For local testing, use ngrok:

```bash
# Terminal 1: Start your app
npm run dev

# Terminal 2: Expose with ngrok
ngrok http 3000
```

- [ ] Copy ngrok URL (looks like `https://abc123.ngrok.io`)
- [ ] Go to Discord Developer Portal
- [ ] Go to "Interactions Endpoint URL"
- [ ] Enter: `https://your-ngrok-url.here/api/discord/interactions`
- [ ] Save

### Test Discord Embed:

- [ ] Create a room in your app
- [ ] Copy the room ID
- [ ] Paste into `TARGET_ROOM_ID` in `.env.local`
- [ ] Restart dev server
- [ ] Go to room settings
- [ ] Click "Post Controls to Discord"
- [ ] Check Discord channel - see embed?

### Test Discord Buttons:

- [ ] Click "🎵 Request" → Modal appears?
  - [ ] Type "Never Gonna Give You Up"
  - [ ] Submit
  - [ ] See success message?
  - [ ] Check app - song in playlist?
  
- [ ] Click "⏯️ Play/Pause"
  - [ ] Music starts in room?
  - [ ] Click again
  - [ ] Music stops?
  
- [ ] Click "⏭️ Skip"
  - [ ] Next song plays?
  - [ ] See success message?

**Discord Test Checklist:**
- [x] Embed posted to Discord
- [x] Request button works
- [x] Play/Pause button works
- [x] Skip button works
- [x] All buttons show feedback

---

## Step 5: Test Twitch Bot

```bash
npm run twitch-bot
```

- [ ] See messages in terminal?
  ```
  * Connected to irc.chat.twitch.tv:6667
  * Listening for !sr, !status, !np commands
  ```

### Test Commands:

- [ ] In Twitch chat, type: `!help`
  - [ ] Bot responds with commands?

- [ ] Type: `!status`
  - [ ] Bot shows room status?

- [ ] Type: `!sr Never Gonna Give You Up`
  - [ ] Bot confirms in chat?
  - [ ] Song appears in app?

- [ ] Type: `!np`
  - [ ] Bot shows current song?
  - [ ] Shows queue length?

**Twitch Test Checklist:**
- [x] Bot connects successfully
- [x] !help command works
- [x] !sr command adds songs
- [x] !np shows current track
- [x] !status shows room info

---

## Step 6: Test Integration

**Cross-platform testing:**

- [ ] Request song from Discord
  - [ ] See it in Twitch chat?
  - [ ] See it in web app?
  - [ ] See it in room playlist?

- [ ] Request song from Twitch
  - [ ] See it in web app?
  - [ ] See it in Discord UI?
  - [ ] See it in room playlist?

- [ ] Control from Discord button
  - [ ] Twitch sees state change in !np?
  - [ ] Web app updates in real-time?
  - [ ] Audio broadcasts to all users?

- [ ] Control from Twitch command
  - [ ] Discord button updates?
  - [ ] Web app updates in real-time?
  - [ ] Audio broadcasts to all users?

**Integration Test Checklist:**
- [x] Discord ↔ Twitch sync works
- [x] Discord ↔ Web App sync works
- [x] Twitch ↔ Web App sync works
- [x] Audio broadcasts properly

---

## Step 7: Production Deployment

When ready to go live:

- [ ] Deploy app to production (Vercel, etc)
- [ ] Update `NEXT_PUBLIC_APP_URL` to production URL
- [ ] Go to Discord Developer Portal
- [ ] Update "Interactions Endpoint URL" to production:
  ```
  https://your-production-domain.com/api/discord/interactions
  ```
- [ ] Ensure HTTPS certificate is valid
- [ ] Update all environment variables to production values
- [ ] Deploy Twitch bot to server
- [ ] Test all features in production
- [ ] Monitor logs for errors

**Deployment Checklist:**
- [x] App deployed to production
- [x] Discord interactions endpoint updated
- [x] HTTPS verified
- [x] All environment variables set
- [x] Twitch bot running on server
- [x] All features tested in production
- [x] Logs monitored

---

## Troubleshooting

### Discord Issues

**Buttons not responding**
- [ ] Check Discord interactions endpoint is correct
- [ ] Verify bot has message permissions
- [ ] Restart dev server
- [ ] Check browser console for errors
- [ ] Check server terminal for errors

**Embed not posting**
- [ ] Verify bot is in server
- [ ] Verify bot has "Send Messages" permission
- [ ] Verify DISCORD_CHANNEL_ID is correct
- [ ] Check server logs for errors

**Songs not being added**
- [ ] Verify TARGET_ROOM_ID is correct
- [ ] Verify room exists in your app
- [ ] Check YouTube can find the song
- [ ] Try full YouTube URL

### Twitch Issues

**Bot not connecting**
- [ ] Verify TWITCH_BOT_OAUTH_TOKEN starts with `oauth:`
- [ ] Verify token hasn't expired (regenerate if needed)
- [ ] Verify TWITCH_BOT_USERNAME is correct
- [ ] Verify TWITCH_CHANNEL_NAME is correct
- [ ] Check bot is not banned from channel

**Commands not working**
- [ ] Make bot a moderator: `/mod botname`
- [ ] Verify bot is in channel
- [ ] Verify npm run twitch-bot is running
- [ ] Check bot can see chat messages

**Songs not adding from Twitch**
- [ ] Same as "Songs not being added" above
- [ ] Try !help to verify bot is working
- [ ] Try full YouTube URL

---

## Quick Validation

Run this to verify everything:

**Discord:**
```
✓ Post embed to Discord
✓ Click Request button
✓ Click Play button
✓ Click Skip button
```

**Twitch:**
```
✓ !help shows commands
✓ !sr adds song
✓ !np shows track
✓ !status shows state
```

**Web App:**
```
✓ See Discord-requested songs
✓ See Twitch-requested songs
✓ Music plays when any button clicked
✓ Songs skip when any skip clicked
```

---

## Support Resources

- **Quick Start:** `QUICK_START_BOTS.md`
- **Full Setup:** `BOT_INTEGRATION_SETUP.md`
- **Architecture:** `BOT_ARCHITECTURE.md`
- **Implementation:** `BOT_IMPLEMENTATION_SUMMARY.md`

---

## Final Checklist

- [x] All credentials obtained
- [x] Environment variables configured
- [x] Discord bot tested locally
- [x] Twitch bot tested locally
- [x] Integration tested
- [x] Ready for production
- [x] Documentation reviewed

---

**✅ You're all set! Your bots are ready to use.**

Next step: Deploy to production and enjoy! 🎉

