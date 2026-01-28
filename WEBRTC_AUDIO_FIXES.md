# WebRTC Audio & YouTube Integration Fixes

## Overview
Your HearMeOut app had three main issues with WebRTC voice chat and YouTube song sharing. These have now been fixed with robust error handling, retry logic, and improved audio streaming.

## Issues Fixed

### 1. **CORS & Piped Instance Failures** ✅
**Problem:** The audio streaming relied on Piped instances which can:
- Go offline unexpectedly
- Have CORS restrictions
- Have inconsistent uptime
- Return incomplete responses

**Solution:**
- Added 6 Piped instances instead of 4 (more redundancy)
- Implemented timeout handling (5-second timeout per instance)
- Added proper HTTP headers for compatibility
- Better error messages and fallback chains

**File:** `src/app/api/youtube-audio/route.ts`

### 2. **No Retry Mechanism** ✅
**Problem:** If audio resolution failed, the user had to manually retry adding the song.

**Solution:**
- Automatic retry logic with exponential backoff (2-second delays)
- Up to 3 retry attempts with configurable behavior
- Server sends `canRetry` flag to indicate if retrying might help
- Client intelligently retries failed requests

**File:** `src/app/rooms/[roomId]/page.tsx` (MusicStreamer component)

### 3. **Poor Error Handling & Audio State Management** ✅
**Problem:** 
- Users couldn't see if audio was loading
- Errors weren't properly communicated
- Audio publication could fail silently
- No feedback on audio playback issues

**Solution:**
- Added audio error state tracking
- Improved error messages for debugging
- Audio event listeners (`oncanplay`, `onplaying`, `onerror`)
- Better logging throughout the pipeline

## Technical Details

### Audio Resolution Flow
```
User adds YouTube URL
    ↓
AddMusicPanel calls getYoutubeInfo()
    ↓
Server extracts YouTube metadata
    ↓
DJ selects song in MusicPlayerCard
    ↓
MusicStreamer fetches audio stream URL via /api/youtube-audio
    ↓
If fails → Retry up to 3 times with 2-second delays
    ↓
Once URL obtained → Create local audio track
    ↓
Publish track to LiveKit via WebRTC
    ↓
All room participants hear audio
```

### Key Changes in `src/app/api/youtube-audio/route.ts`

1. **Additional Piped Instances:**
   ```typescript
   const PIPED_INSTANCES = [
     "https://piped.video",
     "https://pipedapi.kavin.rocks",
     "https://piped.mha.fi",
     "https://piped.privacydev.net",
     "https://piped-api.garudalinux.org",      // NEW
     "https://api.piped.projectsegfau.lt"       // NEW
   ];
   ```

2. **Timeout Handling:**
   ```typescript
   async function fetchWithTimeout(url: string, timeoutMs: number) {
     const controller = new AbortController();
     const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
     // ... with proper cleanup
   }
   ```

3. **Better Error Tracking:**
   - Collects all errors from failed instances
   - Returns retry information to client
   - More specific error messages

### Key Changes in `src/app/rooms/[roomId]/page.tsx`

1. **MusicStreamer Component Enhanced:**
   - `audioError` state to track failures
   - `retryCountRef` to manage retry attempts
   - Automatic retry with 2-second delay
   - Debug event listeners on audio element

2. **Improved WebRTC Publishing:**
   ```typescript
   const publication = await room.localParticipant.publishTrack(track, {
     name: 'music',
     source: 'screen_share'  // Changed from 'music_bot_audio' for better handling
   });
   ```

3. **Better Cleanup:**
   - Proper error handling during unpublish
   - Audio element event listeners for debugging
   - Check for room existence before unpublishing

## How to Test

### 1. **Basic YouTube Integration**
- [ ] Create a new room
- [ ] Add a YouTube song by URL (e.g., https://www.youtube.com/watch?v=dQw4w9WgXcQ)
- [ ] Verify song appears in playlist
- [ ] Play the song as DJ
- [ ] Confirm audio plays in your speaker (check browser console for debug logs)

### 2. **WebRTC Broadcasting**
- [ ] Have 2+ users in the same room
- [ ] One user becomes DJ and plays a song
- [ ] All other users should hear the audio
- [ ] Check DevTools console for "Music track published successfully"

### 3. **Error Scenarios**
- [ ] Try adding a private YouTube video → should get error message
- [ ] Try adding a region-locked video → should attempt retries
- [ ] Disconnect internet temporarily → should show error, retry when reconnected
- [ ] Switch songs quickly → should properly unpublish old, publish new

### 4. **Debugging Checklist**
Open browser DevTools Console and look for:
- `"Incoming URL for audio processing:"` - YouTube URL received
- `"Extracted video ID:"` - Video ID extracted successfully  
- `"Trying Piped instance:"` - Testing each instance
- `"Successfully resolved audio URL from"` - Audio URL found
- `"Audio can play now"` - Audio element ready
- `"Music track published successfully"` - Audio broadcast to room

## Environment Setup

### Required Environment Variables
```
NEXT_PUBLIC_LIVEKIT_URL=your_livekit_server_url
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
```

### Dependencies
The following are already in your `package.json`:
- `livekit-client` - WebRTC library
- `@livekit/components-react` - React components
- `youtube-sr` - YouTube search and metadata
- `genkit` - AI flow orchestration

## Troubleshooting

### "All Piped instances failed"
- Check internet connectivity
- YouTube video might be private or deleted
- Try a different video
- Check browser console for specific instance errors

### Audio not playing in WebRTC
- Ensure you're the DJ (claimed DJ role)
- Check that song is selected and play button is pressed
- Verify audio permissions are granted
- Check LiveKit connection status indicator

### Retry Loop Not Working
- Verify API endpoint is accessible: `/api/youtube-audio`
- Check server logs for timeout issues
- Increase `TIMEOUT_MS` in route.ts if backend is slow

### Audio Quality Issues
- The code automatically selects highest bitrate audio
- Piped instances may vary in quality
- Try skipping to next song and coming back

## Future Improvements

1. **Caching:** Cache resolved audio URLs to reduce API calls
2. **Better Audio Sync:** Implement synchronized playback across users
3. **Song Duration:** Display accurate duration in player
4. **Quality Selection:** Let users choose audio quality
5. **Alternative Sources:** Add fallback to other services if Piped fails
6. **Playlist Persistence:** Save playlist to Firestore for persistence
7. **Audio Visualization:** Add visualizer that syncs with published audio

## Files Modified

1. ✅ `src/app/api/youtube-audio/route.ts` - Better error handling & timeouts
2. ✅ `src/app/rooms/[roomId]/page.tsx` - Improved MusicStreamer component

## Support

For issues or questions:
1. Check the console logs (they're very detailed now)
2. Verify environment variables are set
3. Test with a known-good YouTube video
4. Check Piped instance status (they can go down)

---

**Last Updated:** January 28, 2026
**Status:** All core issues addressed ✅
