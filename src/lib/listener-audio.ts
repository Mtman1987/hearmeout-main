export const LISTENER_AUDIO_PREFIX = 'hearmeout:listener-audio:v1:';
export const LISTENER_AUDIO_EVENT = 'hearmeout:listener-audio';
export const DEFAULT_LISTENER_AUDIO = { volume: 0.85 };
export type ListenerAudio = typeof DEFAULT_LISTENER_AUDIO;

export function parseListenerAudio(raw: string | null, fallback = 0.85): ListenerAudio {
  try {
    const value = JSON.parse(raw || '{}');
    return {
      volume: typeof value.volume === 'number' && Number.isFinite(value.volume)
        ? Math.max(0, Math.min(1, value.volume)) : fallback,
    };
  } catch { return { volume: fallback }; }
}

// Only this browser's storage receives these preferences. No request to the
// shared playback service is made for listener gain or mute.
const memory = new Map<string, string>();
export function readListenerAudioSnapshot(kind: string) {
  const key = LISTENER_AUDIO_PREFIX + kind;
  try { return window.localStorage.getItem(key) || memory.get(key) || null; }
  catch { return memory.get(key) || null; }
}
export function writeListenerAudio(kind: string, patch: Partial<ListenerAudio>) {
  const key = LISTENER_AUDIO_PREFIX + kind;
  const next = parseListenerAudio(JSON.stringify({ ...parseListenerAudio(readListenerAudioSnapshot(kind), kind.startsWith('voice:') ? 1 : 0.85), ...patch }));
  const raw = JSON.stringify(next);
  memory.set(key, raw);
  try { window.localStorage.setItem(key, raw); } catch {}
  window.dispatchEvent(new Event(LISTENER_AUDIO_EVENT));
  return next;
}
