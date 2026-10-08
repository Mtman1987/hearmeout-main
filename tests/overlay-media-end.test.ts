import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { createOverlayCompletionTracker, overlayEndTarget } from '../src/lib/overlay-media-end';
const input = { clean: true, lane: 'music', roomId: 'twitch-123', twitchTenant: '123',
  sourceKey: 'source-123', sessionId: 'watch-twitch-123-music', requestId: 'first' };

test('Twitch source completion advances its own music queue without the lounge condition', () => {
  const target = overlayEndTarget(input)!;
  assert.equal(target.url, '/api/twitch-source/123/ended');
  assert.equal(target.init?.method, 'POST');
  assert.equal((target.init?.headers as any)['x-source-key'], 'source-123');
  assert.deepEqual(JSON.parse(String(target.init?.body)), { expectedRequestId: 'first' });
  for (const changes of [{ clean: false }, { lane: 'movie' }, { sourceKey: '' }, { requestId: '' }]) {
    assert.equal(overlayEndTarget({ ...input, ...changes }), null);
  }
});

test('lounge completion keeps its existing guarded route while other room viewers remain passive', () => {
  const base = { ...input, twitchTenant: '', sourceKey: '' };
  assert.equal(overlayEndTarget({ ...base, roomId: 'private-room' }), null);
  const target = overlayEndTarget({ ...base, roomId: 'system-spacemountainlive-lounge' })!;
  assert.match(target.url, /expectedRequestId=first/);
  assert.match(target.url, /quick-control\?action=next/);
});

test('pending or acknowledged completion cannot replay or report a second end', async () => {
  const tracker = createOverlayCompletionTracker();
  let release!: () => void;
  let calls = 0;
  const report = () => { calls++; return new Promise<void>(r => { release = r; }); };
  const first = tracker.report('first', report);
  assert.equal(tracker.hasEnded('first'), true);
  assert.equal(tracker.hasEnded('second'), false);
  await tracker.report('first', report);
  assert.equal(calls, 1);
  release(); await first;
  await tracker.report('first', report);
  assert.equal(calls, 1);
  tracker.retain('second');
  assert.equal(tracker.hasEnded('first'), true, 'late polling cannot replay the finished request');
});

test('failed queue advance stays ended and retries after backoff', async () => {
  let time = 0;
  const tracker = createOverlayCompletionTracker(() => time);
  let calls = 0;
  await assert.rejects(tracker.report('first', async () => { calls++; throw new Error('Unavailable'); }));
  assert.equal(tracker.hasEnded('first'), true);
  await tracker.report('first', async () => { calls++; });
  assert.equal(calls, 1);
  time = 3000;
  await tracker.report('first', async () => { calls++; });
  assert.equal(calls, 2);
  await tracker.report('first', async () => { calls++; });
  assert.equal(calls, 2);
});

test('the real native end handler advances Twitch video and saved audio, with no lounge-only gate', () => {
  const source = readFileSync('src/app/overlay/[roomId]/page.tsx', 'utf8');
  const at = source.indexOf('onEnded={() => {');
  const arrow = source.slice(at + 'onEnded={'.length, source.indexOf('          onError=', at)).trim().slice(0, -1);
  for (const [mode, position, shouldAdvance] of [['video', 180, true], ['audio', 170, true], ['video', 40, false]] as const) {
    const tracker = createOverlayCompletionTracker();
    const advances: string[] = [];
    const modes: string[] = [];
    const context = vm.createContext({
      videoRef: { current: { currentTime: position } }, activeState: { current: { requestId: 'first' }, playback: { status: 'playing' } },
      nativeProgressBaselineRef: { current: 0 }, setRenderingHealthy() {}, setMediaStatus() {},
      currentItem: { type: 'music', runtime: '3m' }, mediaRuntimeSeconds: () => 180,
      musicPlaybackMode: mode, musicModeOptions: () => ({ audio: '/saved-audio' }),
      setMusicPlaybackMode: (value: string) => modes.push(value), completionRef: { current: tracker },
      advanceRef: { current: (id: string) => advances.push(id) },
    });
    const code = ts.transpileModule('globalThis.runEnd = ' + arrow, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInContext(code, context); vm.runInContext('runEnd()', context);
    assert.deepEqual(advances, shouldAdvance ? ['first'] : []);
    assert.equal(tracker.hasEnded('first'), shouldAdvance);
    assert.deepEqual(modes, shouldAdvance ? [] : ['audio']);
  }
});

test('the real polling callback cannot replay a completed item', () => {
  const source = readFileSync('src/app/overlay/[roomId]/page.tsx', 'utf8');
  const at = source.indexOf('const applyPlaybackState = useCallback(') + 'const applyPlaybackState = useCallback('.length;
  const arrow = source.slice(at, source.indexOf('}, [activeState, applyVolume, embeddedMode, youtubeCommand]);', at) + 1);
  const tracker = createOverlayCompletionTracker(); tracker.markEnded('first');
  let advanced = '';
  const context = vm.createContext({ completionRef: { current: tracker },
    advanceRef: { current: (id: string) => { advanced = id; } },
    activeState: { current: { requestId: 'first' } },
    youtubeCommand() { throw new Error('Finished YouTube media must not play'); },
    videoRef: { current: { play() { throw new Error('Finished native media must not play'); } } },
  });
  vm.runInContext(ts.transpileModule('globalThis.apply = ' + arrow, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  vm.runInContext('apply(activeState)', context);
  assert.equal(advanced, 'first');
});
