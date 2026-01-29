# WebRTC Fixes - Music & Voice Streaming

## Issues Fixed

### 1. Music Not Heard by Other Users
**Problem**: Music was being published to LiveKit but not received by other participants
**Root Cause**: 
- Audio element was hidden (`className="hidden"`) which prevented proper audio routing
- AudioTrack components in UserCard were only rendering microphone tracks, not music tracks
- useTracks hook was filtering for only Microphone source, missing music tracks

**Fix**:
- Removed `className="hidden"` from audio element
- Changed useTracks to include both Microphone and Unknown sources
- Render ALL audio tracks for each participant, not just first microphone track
- Added comprehensive logging to track audio publications

### 2. Users Not Hearing Each Other
**Problem**: Voice chat wasn't working between participants
**Root Cause**:
- AudioTrack component wasn't properly rendering for all participants
- Microphone toggle was only stopping track, not properly enabling/disabling
- Missing proper subscription handling

**Fix**:
- Fixed microphone toggle to use `room.localParticipant.setMicrophoneEnabled()`
- Render AudioTrack for ALL audio tracks from each participant
- Added subscription status logging for debugging
- Proper filtering to ensure each participant's tracks are rendered

### 3. Audio Context Issues
**Problem**: Web Audio API wasn't properly connecting audio to both speakers and LiveKit
**Root Cause**:
- Audio context wasn't being resumed when suspended
- Source node was only connected to destination (LiveKit), not to speakers
- Missing proper cleanup and error handling

**Fix**:
- Check and resume AudioContext if suspended
- Connect source node to BOTH destination (LiveKit) AND context.destination (speakers)
- Proper cleanup of audio context on unmount
- Added comprehensive error logging
- Set audio element volume to 1.0 for local playback

## Key Changes

### MusicStreamer Component
```typescript
// Connect to BOTH LiveKit and speakers
sourceNodeRef.current.connect(destinationRef.current); // LiveKit
sourceNodeRef.current.connect(audioContextRef.current.destination); // Speakers

// Set full volume for local playback
audioEl.volume = 1.0;

// Publish with proper source type
await room.localParticipant.publishTrack(audioTrack, { 
    name: 'music',
    source: LivekitClient.Track.Source.Microphone,
});
```

### UserCard Component
```typescript
// Get ALL audio tracks (microphone + music)
const allAudioTracks = useTracks(
    [LivekitClient.Track.Source.Microphone, LivekitClient.Track.Source.Unknown],
    { onlySubscribed: false, participant }
).filter(track => track.participant.identity === participant.identity);

// Render ALL tracks
{!isLocal && allAudioTracks.map((trackRef) => (
    <AudioTrack 
        key={trackRef.publication.trackSid} 
        trackRef={trackRef} 
        volume={volume}
    />
))}
```

### Microphone Toggle
```typescript
const handleToggleMic = async () => {
    if (isLocal && room) {
        const enabled = participant.isMicrophoneEnabled;
        await room.localParticipant.setMicrophoneEnabled(!enabled);
    }
};
```

## Testing Checklist

- [ ] DJ can hear music locally
- [ ] Other users can hear music through LiveKit
- [ ] Users can hear each other's microphones
- [ ] Microphone toggle works (mute/unmute)
- [ ] Volume slider controls remote participant volume
- [ ] Music syncs perfectly across all users
- [ ] No audio dropouts or glitches
- [ ] Audio continues after tab switch
- [ ] Multiple users can join and hear everything

## Debug Logging

Added comprehensive logging throughout:
- `[MusicStreamer]` - Music streaming setup and errors
- `[UserList]` - Participant audio track publications
- `[UserCard]` - Audio track rendering and subscriptions

Check browser console for these logs to debug audio issues.

## Known Limitations

- Music is published as Microphone source (LiveKit limitation for audio streaming)
- Audio element must not be hidden for proper Web Audio API routing
- AudioContext must be resumed on user interaction (browser security)
