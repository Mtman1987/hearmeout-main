import test from 'node:test';
import assert from 'node:assert/strict';
import { captureMicrophone, encodeMonoWav, MIC_MAX_SECONDS, MIC_SAMPLE_RATE } from '../src/lib/microphone-capture';

test('portable mono PCM clip stays within the verified free transcription audio limit', async () => {
  const blob = encodeMonoWav(new Float32Array(MIC_SAMPLE_RATE * MIC_MAX_SECONDS));
  const view = new DataView(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav');
  assert.equal(blob.size, 480044);
  assert.ok(blob.size <= 512000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16);
});
test('WAV clamps clipping without wrapping loud microphone samples', async () => {
  const view = new DataView(await encodeMonoWav(new Float32Array([-2, 0, 2])).arrayBuffer());
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(46, true), 0);
  assert.equal(view.getInt16(48, true), 32767);
});

test('cancelling during microphone permission closes the eventual track and captures nothing', async t => {
  let grant!: (stream: any) => void;
  let tracksStopped = 0, contextsClosed = 0;
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  class Context {
    state = 'running';
    resume() { return Promise.resolve(); }
    close() { contextsClosed++; this.state = 'closed'; return Promise.resolve(); }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true, AudioContext: Context } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } } });
  t.after(() => {
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else delete (globalThis as any).window;
    if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator); else delete (globalThis as any).navigator;
  });
  const capture = captureMicrophone();
  const rejected = assert.rejects(capture.finished, /cancelled/);
  capture.cancel();
  grant({ getTracks: () => [{ stop: () => tracksStopped++ }] });
  await rejected;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tracksStopped, 1);
  assert.equal(contextsClosed, 1);
});

