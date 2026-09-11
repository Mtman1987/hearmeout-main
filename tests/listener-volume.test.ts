import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { sharedPlayerScript } from '../src/lib/shared-player-script';
import { parseListenerAudio, LISTENER_AUDIO_PREFIX } from '../src/lib/listener-audio';
import { applyParticipantVolume, peerVoiceIdentity } from '../src/lib/participant-volume';

function listener(savedVolume: number) {
  const elements = new Map<string, any>();
  const calls: any[] = [];
  const handlers = new Map<string, Function[]>();
  const storage = new Map([[LISTENER_AUDIO_PREFIX + 'music', JSON.stringify({ volume: savedVolume })]]);
  let pauses = 0; let mutedWrites = 0;
  function element(id: string) {
    if (elements.has(id)) return elements.get(id);
    const events: Record<string, Function> = {};
    const node: any = { value: '', textContent: '', paused: true, currentTime: 0, readyState: 4,
      addEventListener(name: string, fn: Function) { events[name] = fn; }, events,
      replaceChildren() {}, appendChild() {}, setAttribute() {}, removeAttribute() {}, load() {},
      pause() { pauses++; this.paused = true; }, async play() { this.paused = false; },
      set muted(_value: boolean) { mutedWrites++; },
    };
    elements.set(id, node); return node;
  }
  class FakeHls {
    static instances: FakeHls[] = []; static isSupported() { return true; }
    static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    events: Record<string, Function> = {}; source = ''; destroyed = false;
    constructor() { FakeHls.instances.push(this); }
    on(name: string, fn: Function) { this.events[name] = fn; }
    loadSource(source: string) { this.source = source; }
    attachMedia() { this.events.manifest(); }
    destroy() { this.destroyed = true; }
  }
  const window = { Hls: FakeHls, parent: { postMessage() {} },
    addEventListener(name: string, fn: Function) { handlers.set(name, [...handlers.get(name) || [], fn]); },
    dispatchEvent(event: Event) { for (const fn of handlers.get(event.type) || []) fn(event); },
  };
  const context = vm.createContext({ window, Hls: FakeHls, Event, URL, URLSearchParams, console,
    location: new URL('https://hmo.test/activity?sessionId=music'),
    document: { getElementById: element, querySelectorAll: () => [], createElement: () => element('li') },
    localStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) },
    fetch(url: string, options: any) { calls.push({ url, options }); return new Promise(() => {}); },
    setInterval() { return 1; }, clearInterval() {}, history: { replaceState() {} },
  });
  vm.runInContext(sharedPlayerScript('', 'discord-music-room', 'https://hmo.test'), context);
  return { context, elements, calls, storage, FakeHls, pauses: () => pauses, mutedWrites: () => mutedWrites };
}
const state = (id = 'song-a') => ({ current: { requestId: id, item: { title: id, playbackUrl: `/api/watch/stream/music/index.m3u8?requestId=${id}` } }, queue: [], playback: { muted: true, volume: 1, status: 'paused' } });
function render(view: ReturnType<typeof listener>, id?: string) { view.context.next = state(id); vm.runInContext('renderState(next)', view.context); }

test('zero volume never pauses, mutes, or sends controls; polling cannot restore it', async () => {
  const a = listener(0.4), b = listener(0.7);
  render(a); render(b); await Promise.resolve();
  const before = a.pauses();
  const slider = a.elements.get('volume'); slider.value = '0'; slider.events.input();
  for (let i = 0; i < 12; i++) { render(a); render(b); }
  assert.equal(a.elements.get('video').volume, 0);
  assert.equal(a.elements.get('video').paused, false);
  assert.equal(a.pauses(), before); assert.equal(a.mutedWrites(), 0);
  assert.equal(b.elements.get('video').volume, 0.7); assert.equal(b.elements.get('video').paused, false);
  assert.equal(a.calls.length, 1); assert.equal(a.calls[0].options.method, undefined);
  assert.equal(a.FakeHls.instances.length, 1); assert.equal(b.FakeHls.instances.length, 1);
  assert.equal(a.FakeHls.instances[0].source, b.FakeHls.instances[0].source);
  assert.equal(JSON.parse(a.storage.get(LISTENER_AUDIO_PREFIX + 'music')!).volume, 0);
  render(a, 'song-b'); await Promise.resolve();
  assert.equal(a.elements.get('video').volume, 0); assert.equal(a.elements.get('video').paused, false);
  assert.equal(a.mutedWrites(), 0);
});

test('saved zero survives startup and obsolete player errors cannot disrupt its replacement', async () => {
  const a = listener(0); render(a); const old = a.FakeHls.instances[0]; render(a, 'song-b');
  old.events.error(null, { fatal: true });
  assert.equal(vm.runInContext('retryAt', a.context), 0);
  assert.equal(a.elements.get('video').volume, 0);
  assert.equal(parseListenerAudio('{"volume":0}').volume, 0);
  assert.equal(parseListenerAudio('{"volume":99}').volume, 1);
  assert.equal(parseListenerAudio('invalid', 1).volume, 1);
});

test('participant, persona and mixed Discord tracks receive gain only, including unknown-source tracks', () => {
  const calls: any[] = []; const trackCalls: any[] = [];
  const participant = { isLocal: false, setVolume: (...args: any[]) => calls.push(args),
    audioTrackPublications: new Map([['track', { track: { setVolume: (v: number) => trackCalls.push(v) } }]]),
    setMuted() { throw new Error('must not mute'); }, setSubscribed() { throw new Error('must not unsubscribe'); },
  };
  applyParticipantVolume(participant, 0);
  assert.deepEqual(calls, [[0, 'microphone'], [0, 'screen_share_audio'], [0, 'unknown']]);
  assert.deepEqual(trackCalls, [0]);
  applyParticipantVolume({ ...participant, isLocal: true }, 1); assert.equal(calls.length, 3);
  assert.equal(peerVoiceIdentity('my-room', 'hmo-voice-my-room-user-with-dashes-1ab2'), 'user-with-dashes');
  assert.equal(peerVoiceIdentity('another-room', 'hmo-voice-my-room-user-1ab2'), null);
});

test('Web Audio gain reaches zero without touching mute or pausing the element', async () => {
  const { createLocalMediaGain } = await import('../src/lib/local-media-gain');
  const values: number[] = [];
  const gain = { gain: { setValueAtTime(v: number) { values.push(v); } }, connect() {}, disconnect() {} };
  const context = { state: 'running', currentTime: 12, createGain: () => gain,
    createMediaElementSource: () => ({ connect() {}, disconnect() {} }), resume: async () => {}, close: async () => {} };
  const previous = globalThis.window;
  (globalThis as any).window = { AudioContext: class { constructor() { return context; } } };
  try {
    const element: any = { volume: 0.4, pause() { throw new Error('pause'); }, set muted(_: boolean) { throw new Error('mute'); } };
    const output = createLocalMediaGain(element);
    output.setVolume(0.4); output.setVolume(0); await output.resume();
    assert.deepEqual(values, [0.4, 0]); assert.equal(element.volume, 1); assert.equal(output.blocked, false);
    output.close();
  } finally { (globalThis as any).window = previous; }
});
