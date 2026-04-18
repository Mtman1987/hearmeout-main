# HearMeOut Fly.io Debug & Fixes
Status: 🔧 Production deploy issues resolved step-by-step.

## Completed ✅
- [x] App starts on 3001, health check passes (/api/health)
- [x] LiveKit tokens generate successfully
- [x] ESLint warnings identified (next.config.js)

## In Progress 🔄
1. **Fix ESLint warnings** - Edit next.config.js (remove eslint block)
2. **Fix Twitch bot auth** 
   - Generate real OAuth: https://twitchapps.com/tmi/ → `oauth:xxxxxxxx`
   - `fly secrets set TWITCH_BOT_OAUTH_TOKEN=oauth:real_token --app hearmeout-main`
3. **Deploy & test**
   - `fly deploy`
   - `fly logs` → Look for 'Connected to Twitch'

## Next
- Step 1: Edit config → deploy → verify no ESLint logs

Test: Twitch chat !sr → song queue → ripper trigger.
