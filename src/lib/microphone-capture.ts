// Deliberate microphone-only capture. No display, tab, loopback, or stream audio.
export const MIC_SAMPLE_RATE = 16000;
export const MIC_MAX_SECONDS = 15;

export function encodeMonoWav(samples: Float32Array, sampleRate = MIC_SAMPLE_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) => { const sample = Math.max(-1, Math.min(1, value)); view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true); });
  return new Blob([buffer], { type: 'audio/wav' });
}

export function microphoneError(error: unknown): string {
  const e = error as { name?: string; message?: string };
  if (['NotAllowedError', 'SecurityError'].includes(e?.name || '')) return 'Microphone permission is blocked. Allow Microphone for this site, then tap again.';
  if (e?.name === 'NotFoundError') return 'No microphone was found on this device.';
  if (e?.name === 'NotReadableError') return 'The microphone is busy. Close the other microphone session and try again.';
  return e?.message || 'The microphone could not start.';
}

export function captureMicrophone(options: {
  ready?(): void;
  level?(level: number): void;
  silenceTimeoutMs?: number;
  maxSeconds?: number;
} = {}) {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let sink: GainNode | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ended = false;
  let requestedStop = false;
  let sampleCount = 0;
  let heardSound = false;
  let lastSoundAt = 0;
  const chunks: Float32Array[] = [];
  let resolve!: (blob: Blob) => void;
  let reject!: (error: Error) => void;
  const finished = new Promise<Blob>((done, fail) => { resolve = done; reject = fail; });
  const cleanup = () => {
    clearTimeout(timer);
    if (processor) processor.onaudioprocess = null;
    try { source?.disconnect(); processor?.disconnect(); sink?.disconnect(); } catch {}
    stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  };
  const fail = (error: unknown) => {
    if (ended) return;
    ended = true; cleanup(); reject(new Error(microphoneError(error)));
  };
  const stop = () => {
    if (ended) return;
    if (!stream || !processor) { requestedStop = true; return; }
    ended = true; cleanup();
    if (!heardSound || sampleCount < MIC_SAMPLE_RATE / 4) {
      reject(new Error('No microphone speech was captured. Speak after the microphone is ready, then tap Finish.'));
      return;
    }
    const samples = new Float32Array(sampleCount);
    let offset = 0;
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    resolve(encodeMonoWav(samples));
  };
  const cancel = () => {
    if (ended) return;
    ended = true; cleanup(); reject(new Error('Microphone capture cancelled.'));
  };

  // Construct/resume in the tap handler, before awaiting microphone permission.
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture needs a secure browser page. Open this page in Chrome or Safari.');
    const Context = window.AudioContext || (window as any).webkitAudioContext;
    if (!Context) throw new Error('This browser cannot record microphone audio. Open this page in Chrome or Safari.');
    context = new Context();
    const resume = context!.resume();
    void navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }).then(async acquired => {
      stream = acquired;
      if (ended) { cleanup(); return; }
      await resume;
      if (ended) { cleanup(); return; }
      if (requestedStop) { cancel(); return; }
      source = context!.createMediaStreamSource(acquired);
      processor = context!.createScriptProcessor(4096, 1, 1);
      sink = context!.createGain(); sink.gain.value = 0;
      const maxSamples = MIC_SAMPLE_RATE * Math.min(MIC_MAX_SECONDS, Math.max(1, options.maxSeconds || MIC_MAX_SECONDS));
      processor.onaudioprocess = event => {
        if (ended) return;
        const input = event.inputBuffer.getChannelData(0);
        let energy = 0;
        for (const value of input) energy += value * value;
        const level = Math.sqrt(energy / input.length);
        options.level?.(level);
        if (level > 0.008) { heardSound = true; lastSoundAt = Date.now(); }
        const ratio = context!.sampleRate / MIC_SAMPLE_RATE;
        const count = Math.min(Math.floor(input.length / ratio), maxSamples - sampleCount);
        const output = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          const from = Math.floor(i * ratio), to = Math.min(input.length, Math.floor((i + 1) * ratio));
          let sum = 0;
          for (let j = from; j < to; j++) sum += input[j];
          output[i] = sum / Math.max(1, to - from);
        }
        chunks.push(output); sampleCount += count;
        if (sampleCount >= maxSamples || (heardSound && Number(options.silenceTimeoutMs) > 0 && Date.now() - lastSoundAt >= Number(options.silenceTimeoutMs))) stop();
      };
      source.connect(processor); processor.connect(sink); sink.connect(context!.destination);
      timer = setTimeout(stop, Math.min(MIC_MAX_SECONDS, Math.max(1, options.maxSeconds || MIC_MAX_SECONDS)) * 1000);
      options.ready?.();
    }).catch(fail);
    void resume.catch(fail);
  } catch (error) { fail(error); }
  return { stop, cancel, finished };
}

export async function microphoneBlobToBase64(blob: Blob): Promise<string> {
  if (!blob.size || blob.size > 512000) throw new Error('Microphone clip is empty or exceeds the 15-second limit.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read microphone recording.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(blob);
  });
}
