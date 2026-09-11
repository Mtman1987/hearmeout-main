'use strict';
const { spawn } = require('node:child_process');
const { mkdirSync, rmSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');

/** One producer per media kind, shared by every viewer. Never keyed by room,
 * guild, user, browser or iframe. A source is admitted only after the app
 * confirms it is still the authoritative current request. */
class SharedMediaRelay {
  constructor({ root, resolveSource, validateSource = async () => true, onEnded, spawnProcess = spawn, segmentSeconds = 4, segments = 30, completionDelayMs, retryDelayMs = 5000 }) {
    Object.assign(this, { root, resolveSource, validateSource, onEnded, spawnProcess, segmentSeconds, segments, completionDelayMs, retryDelayMs });
    this.slots = new Map();
    this.locks = new Map();
  }
  async ensure(kind, requestId) {
    const previous = this.locks.get(kind) || Promise.resolve();
    const work = previous.catch(() => {}).then(() => this.start(kind, requestId));
    this.locks.set(kind, work);
    try { return await work; }
    finally { if (this.locks.get(kind) === work) this.locks.delete(kind); }
  }
  async start(kind, requestId) {
    if (!['movie', 'music'].includes(kind)) throw new Error('Invalid media kind');
    const existing = this.slots.get(kind);
    if (existing?.requestId === requestId) return existing;
    if (!await this.validateSource(kind, requestId)) throw new Error('Source changed');
    // Close the former producer before starting its replacement. Paused,
    // failed and completed producers never consume an extra slot.
    if (existing) {
      existing.cancelled = true;
      clearTimeout(existing.endTimer);
      if (existing.process && !existing.finished) {
        existing.process.kill('SIGTERM');
        const killTimer = setTimeout(() => existing.process.kill('SIGKILL'), 5000);
        killTimer.unref?.();
        await existing.closed;
        clearTimeout(killTimer);
      }
    }
    let source;
    try { source = await this.resolveSource(kind, requestId); }
    catch (_) {
      const slot = { kind, requestId, cancelled: false, finished: true, error: 'The shared media source could not be opened.' };
      this.slots.set(kind, slot);
      this.reportEnd(slot, this.completionDelayMs ?? 2000);
      return slot;
    }
    if (!source) throw new Error('Source changed');
    const parentDir = join(this.root, kind);
    const dir = join(parentDir, createHash('sha256').update(requestId).digest('hex').slice(0, 24));
    rmSync(parentDir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '1'];
    for (const input of source.inputs) {
      // Read at playback speed. An unpaced converter used to race through a
      // movie and delete its opening segments before listeners reached them.
      args.push('-re');
      if (input.headers) args.push('-headers', input.headers);
      args.push('-i', input.url);
    }
    if (source.video !== false) args.push('-map', '0:v:0?', '-c:v', 'libx264', '-threads', '1', '-vf', 'scale=w=min(1280\\,iw):h=-2', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-force_key_frames', `expr:gte(t,n_forced*${this.segmentSeconds})`);
    args.push('-map', `${source.audioInput || 0}:${Number.isInteger(source.audioStreamIndex) ? source.audioStreamIndex + '?' : 'a:0?'}`, '-c:a', 'aac', '-ac', '2', '-b:a', '128k', '-f', 'hls',
      '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
      '-hls_time', String(this.segmentSeconds), '-hls_list_size', String(this.segments),
      '-hls_delete_threshold', '3', '-hls_start_number_source', 'epoch',
      '-hls_flags', 'delete_segments+independent_segments+omit_endlist+temp_file',
      '-hls_segment_filename', join(dir, 'seg_%09d.m4s'), join(dir, 'index.m3u8'));
    const process = this.spawnProcess('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const slot = { requestId, kind, dir, process, cancelled: false, finished: false, error: null, endTimer: null };
    this.slots.set(kind, slot);
    slot.closed = new Promise(resolve => {
      let closed = false;
      const finish = (code) => {
        if (closed) return;
        closed = true; slot.finished = true; resolve();
        if (slot.cancelled) return;
        if (code !== 0) slot.error = 'The shared media source could not be played.';
        // Completion comes from this producer, never from viewers' ended
        // events. Allow the final buffered segments to reach listeners.
        this.reportEnd(slot, this.completionDelayMs ?? (code === 0 ? this.segmentSeconds * 3000 : 2000));
      };
      // Drain stderr without logging provider URLs or credentials.
      process.stderr?.on('data', () => {});
      process.once('error', () => finish(-1));
      process.once('close', finish);
    });
    return slot;
  }
  reportEnd(slot, delay) {
    slot.endTimer = setTimeout(async () => {
      if (slot.cancelled || this.slots.get(slot.kind) !== slot) return;
      try { await this.onEnded(slot.kind, slot.requestId, slot.error); }
      catch (_) { this.reportEnd(slot, this.retryDelayMs); }
    }, delay);
    slot.endTimer.unref?.();
  }
  async close() {
    await Promise.allSettled([...this.locks.values()]);
    await Promise.all([...this.slots.values()].map(async slot => {
      slot.cancelled = true;
      clearTimeout(slot.endTimer);
      if (slot.process && !slot.finished) { slot.process.kill('SIGKILL'); await slot.closed; }
    }));
  }
  async file(kind, requestId, name) {
    if (!/^(index\.m3u8|init\.mp4|seg_\d+\.m4s)$/.test(name)) return null;
    const slot = name === 'index.m3u8' ? await this.ensure(kind, requestId) : this.slots.get(kind);
    if (!slot || slot.requestId !== requestId || slot.cancelled) return null;
    if (slot.error) throw new Error(slot.error);
    const path = join(slot.dir, name);
    if (!existsSync(path)) return null;
    return { path, contentType: name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4' };
  }
  snapshot() {
    return [...this.slots.values()].map(({ kind, requestId, finished, error }) => ({ kind, requestId, producing: !finished, error }));
  }
}
module.exports = { SharedMediaRelay };
