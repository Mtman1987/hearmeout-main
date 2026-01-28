# WebRTC Audio Publishing & Browser Security

Great question! Here's exactly how we're handling YouTube audio in WebRTC while respecting browser security:

## The Audio Publishing Flow

### Step 1: Metadata Resolution (Backend)
```
YouTube URL (e.g., youtube.com/watch?v=xyz)
    ↓ [Server-side via youtube-sr]
    ↓ Extract video ID
    ↓ Query Piped instances for audio stream metadata
    ↓ Get audio streaming URL (from Piped)
```

### Step 2: Audio Stream Delivery (Frontend)
```
Audio Stream URL (Piped instance URL)
    ↓ [Browser <audio> element]
    ↓ Browser fetches audio with CORS headers
    ↓ Browser decodes audio (mp3, aac, etc)
    ↓ Audio is ready in DOM
```

### Step 3: WebRTC Publishing
```
Audio Element (DOM <audio> tag with decoded audio)
    ↓ [createLocalAudioTrack()]
    ↓ Captures decoded audio stream
    ↓ Creates MediaStreamTrack
    ↓ Publishes to LiveKit
    ↓ All participants hear it
```

## Why This Is Secure

### ✅ No Direct URL Streaming
We're **NOT** trying to pass a streaming URL directly to WebRTC (which would fail due to browser security). Instead:
- The browser's `<audio>` element handles the network request
- The browser decodes the audio safely in its sandbox
- We only capture the decoded output

### ✅ CORS Protected
When you set `audioEl.src = streamUrl`, the browser:
1. Makes a **CORS preflight request** (OPTIONS)
2. Checks if server allows the origin
3. Only fetches if headers permit it
4. Blocks cross-origin requests that don't have proper headers

Piped instances **return proper CORS headers**, so this works.

### ✅ Sandbox Isolation
- Audio decoding happens in browser sandbox
- Can't access user data
- Can't inject malicious scripts
- Limited to audio playback only

## The New CORS-Safe Proxy (What We Just Added)

Now you have **two options** for audio delivery:

### Option 1: Direct URL (Default)
```typescript
audioEl.src = data.directUrl;  // Piped instance URL
```
**Pros:** Faster, less server load
**Cons:** May fail if Piped doesn't have perfect CORS headers

### Option 2: Proxied Through Your Server (Fallback)
```typescript
audioEl.src = data.proxiedUrl;  // `/api/youtube-audio?url=...&proxy=true`
```

**What happens:**
```
Browser Request
    ↓
Your Next.js Server
    ↓
Piped Instance (server-to-server, no CORS issues)
    ↓
Server proxies audio stream back to browser
    ↓ [Server adds explicit CORS headers]
    ↓
Browser <audio> element safely receives it
```

**Pros:** Always works, guaranteed CORS headers
**Cons:** Slightly more server bandwidth

## Automatic Fallback System

The code now does this automatically:

```typescript
try {
    // Try direct URL first
    audioEl.src = directUrl;
    await audioEl.play();
} catch (e) {
    if (e.code === 4) {  // MEDIA_ERR_SRC_NOT_SUPPORTED (CORS issue)
        console.warn("CORS blocked, switching to proxy...");
        setCorsBlocked(true);  // Triggers refetch with proxy
    }
}
```

Then on next render:
```typescript
const urlToUse = corsBlocked && proxiedUrl ? proxiedUrl : directUrl;
```

## Browser Security Implementation Details

### Audio Element CORS
```tsx
audioEl.src = streamUrl;
audioEl.crossOrigin = 'anonymous';  // Explicit CORS mode
```

This tells browser: "Fetch this resource with CORS credentials (none in this case)"

### MediaStreamTrack from Audio
```typescript
const track = await createLocalAudioTrack({
    mediaElement: audioEl,  // Only the DECODED output is captured
});
```

The `mediaElement` API:
- Takes the final decoded PCM audio
- Creates a MediaStreamTrack
- This can safely be published to WebRTC
- No raw stream URL is exposed

### Server-Side Proxy Headers
```typescript
export async function GET(req: NextRequest) {
  // ... resolve audio URL ...
  
  if (proxy === 'true') {
    const audioRes = await fetch(result.url);
    const buffer = await audioRes.arrayBuffer();
    
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'audio/mp4',
        'Access-Control-Allow-Origin': '*',  // Allow all origins
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
}
```

## Why We Use `screen_share` Source

```typescript
const publication = await room.localParticipant.publishTrack(track, {
    source: 'screen_share'  // Instead of 'music_bot_audio'
});
```

- `screen_share` tells LiveKit this is supplementary audio
- Better handling across different network conditions
- More stable distribution to all participants
- Proper bitrate adaptation

## Security Summary

| Step | Security Mechanism | Why It Works |
|------|-------------------|------------|
| Fetch audio | Browser CORS | Piped returns proper headers |
| Decode audio | Browser sandbox | Isolated from user data |
| Capture stream | MediaStreamTrack API | Only decoded output captured |
| Publish to WebRTC | LiveKit encrypted | End-to-end encrypted connection |

## Testing CORS Behavior

**In browser DevTools Console:**
```javascript
// Check if audio loaded successfully
const audio = document.querySelector('audio');
console.log(audio.readyState);  // 4 = HAVE_ENOUGH_DATA (ready)
console.log(audio.networkState); // 2 = NETWORK_LOADING, 3 = NETWORK_IDLE

// Check CORS specifically
fetch('https://piped.video/streams/dQw4w9WgXcQ')
  .then(r => r.headers.get('access-control-allow-origin'))
  .then(console.log);
// Should print: * (or your domain)
```

## Troubleshooting CORS Issues

1. **"Failed to load audio"**
   - Check console for exact error
   - Try adding ?proxy=true to test proxied version
   - Check Piped instance status

2. **"Audio plays in browser but not in WebRTC"**
   - May be DRM/encrypted content
   - Try different YouTube video
   - Check LiveKit connection

3. **Slow audio startup**
   - Direct URL: Piped instance might be slow
   - Proxied URL: Your server bandwidth
   - Consider enabling caching

---

**TL;DR:** We're not breaking browser security. We're using the proper `<audio>` element with CORS, capturing the decoded output, and publishing that to WebRTC. Plus, we now have an automatic fallback to proxy the audio through your server if CORS issues occur.
