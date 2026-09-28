const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test('Lounge worker owns movie and music state, including queue handoff', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-lounge-program-'));
  const previous = { ...process.env };
  const originalFetch = global.fetch;
  try {
    process.env.LOUNGE_STATE_FILE = join(root, 'program.json');
    process.env.XTREAM_BASE_URL = 'https://provider.example';
    process.env.XTREAM_USERNAME = 'demo';
    process.env.XTREAM_PASSWORD = 'private';
    process.env.XTREAM_ENABLE_SERIES = 'false';
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'yt-dlp'), '#!/bin/sh\ncase "$*" in *--flat-playlist*) echo \'{"entries":[{"id":"M7lc1UVf-VE","title":"Playlist Song","duration":120}]}\';; *) echo \'{"id":"dQw4w9WgXcQ","title":"Test Song","uploader":"Test Artist","duration":180}\';; esac\n', { mode: 0o755 });
    process.env.PATH = `${bin}:${previous.PATH}`;
    global.fetch = async url => {
      assert.equal(new URL(url).searchParams.get('action'), 'get_vod_streams');
      return { ok: true, json: async () => [{ stream_id: 42, name: 'Space Jam', container_extension: 'mp4', year: '2021' }] };
    };
    const program = require('../src/lounge-program');
    assert.deepEqual((await program.search('space jam')).map(item => item.title), ['Space Jam']);
    const movie = await program.request({ lane: 'movie', query: 'space jam', actorName: 'mtman1987' });
    assert.equal(movie.session.current.item.title, 'Space Jam');
    assert.equal(program.program().movie.playback.status, 'playing');
    assert.equal(program.source(program.program().movie), 'https://provider.example/movie/demo/private/42.mp4');
    const music = await program.request({ lane: 'music', query: 'test song', actorName: 'viewer' });
    assert.equal(music.session.current.item.metadata.videoId, 'dQw4w9WgXcQ');
    assert.equal(program.program().movie.playback.status, 'paused');
    assert.equal(program.program().music.playback.status, 'playing');
    const queued = await program.request({ lane: 'music', query: 'test song', actorName: 'viewer2' });
    assert.equal(program.program().music.current.requestId, music.request.requestId);
    assert.equal(JSON.parse(readFileSync(process.env.LOUNGE_STATE_FILE)).music.queue[0].requestId, queued.request.requestId);
    program.control({ lane: 'music', control: 'next' });
    assert.equal(program.program().music.current.requestId, queued.request.requestId);
    program.control({ lane: 'music', control: 'clear' });
    assert.equal(program.program().movie.playback.status, 'playing');
    const radio = await program.radio({ control: 'add', query: 'https://www.youtube.com/playlist?list=PLtest' });
    assert.equal(radio.radio.seedCount, 2);
    await program.radio({ control: 'on' });
    assert.equal(program.program().music.current.item.metadata.videoId, 'dQw4w9WgXcQ');
    program.control({ lane: 'music', control: 'next' });
    assert.equal(program.program().music.current.item.metadata.videoId, 'M7lc1UVf-VE');
    program.tick(Date.now() + 121000);
    assert.equal(program.program().music.current.item.metadata.videoId, 'dQw4w9WgXcQ');
    await program.radio({ control: 'off' });
    program.control({ lane: 'music', control: 'next' });
    assert.equal(program.program().music.current, null);
  } finally {
    global.fetch = originalFetch;
    Object.keys(process.env).forEach(key => { if (!(key in previous)) delete process.env[key]; });
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});
