// Adjust receive gain only. Never mute/unsubscribe a publication or change
// another listener's audio. Unknown-source tracks include bridge/persona audio.
export function applyParticipantVolume(participant: any, volume: number) {
  if (participant.isLocal) return;
  const gain = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
  for (const source of ['microphone', 'screen_share_audio', 'unknown']) {
    participant.setVolume?.(gain, source);
  }
  for (const publication of participant.audioTrackPublications?.values() || []) {
    publication.track?.setVolume?.(gain);
  }
}

export function peerVoiceIdentity(roomId: string, peerId: string) {
  const prefix = `hmo-voice-${roomId}-`;
  if (!peerId.startsWith(prefix)) return null;
  const identity = peerId.slice(prefix.length).replace(/-[a-z0-9]{1,4}$/, '');
  return identity || null;
}
