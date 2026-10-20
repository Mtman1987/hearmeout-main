export type AudioTrackCandidate = {
  index: number;
  name?: string | null;
  language?: string | null;
};

const COMMENTARY_LABEL = /commentary|director(?:'s)?\s+commentary|audio description|descriptive audio|visually impaired|narration/i;

/**
 * Prefer an ordinary audio track over tracks explicitly labelled as commentary
 * or descriptive audio. Language alone is not evidence that a track is clean.
 * Returns -1 when every advertised track looks like commentary so callers do
 * not silently claim a clean track was selected.
 */
export function preferredAudioTrackIndex(tracks: AudioTrackCandidate[]): number {
  if (!tracks.length) return -1;
  const ordinaryTracks = tracks.filter((track) =>
    !COMMENTARY_LABEL.test(`${track.name || ''} ${track.language || ''}`),
  );
  if (!ordinaryTracks.length) return -1;
  const english = ordinaryTracks.find((track) =>
    /\benglish\b/i.test(String(track.name || '')) ||
    /^(?:en|eng)$/i.test(String(track.language || '')),
  );
  return (english || ordinaryTracks[0]).index;
}
