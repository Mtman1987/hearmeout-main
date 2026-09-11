// Self-contained so the standalone player can use this exact implementation.
// Web Audio gain works independently of native mute/pause controls and avoids
// relying solely on the volume property on mobile media elements.
export function createLocalMediaGain(element: HTMLMediaElement, suppliedContext?: AudioContext | null) {
  const Context = window.AudioContext || (window as any).webkitAudioContext;
  let context: AudioContext | null = null;
  let source: MediaElementAudioSourceNode | null = null;
  let gain: GainNode | null = null;
  if (Context) {
    try {
      context = suppliedContext || new Context();
      gain = context!.createGain();
      source = context!.createMediaElementSource(element);
      source.connect(gain!); gain!.connect(context!.destination);
      element.volume = 1;
    } catch (_) {
      source?.disconnect(); gain?.disconnect();
      if (!suppliedContext) void context?.close().catch(() => {});
      context = null; source = null; gain = null;
    }
  }
  return {
    setVolume(value: number) {
      const volume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
      if (gain && context) gain.gain.setValueAtTime(volume, context.currentTime);
      else element.volume = volume;
    },
    resume() { return context?.resume().catch(() => {}) || Promise.resolve(); },
    get blocked() { return !!context && context.state !== 'running'; },
    close() { source?.disconnect(); gain?.disconnect(); if (!suppliedContext) void context?.close().catch(() => {}); },
  };
}
