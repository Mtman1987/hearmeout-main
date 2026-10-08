const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test('all source probes share a 35-second budget and cannot enqueue after it expires', async () => {
  const vm = require('node:vm');
  const root = mkdtempSync(join(tmpdir(), 'hmo-movie-deadline-'));
  let now = 1000;
  const timeouts = [];
  const context = vm.createContext({
    module: { exports: {} },
    require(name) {
      if (name === 'node:child_process') return { execFile(command, args, options, callback) {
        timeouts.push(options.timeout);
        now += options.timeout;
        callback(new Error('timed out'));
      } };
      return require(name);
    },
    process: { env: { LOUNGE_STATE_FILE: join(root, 'program.json'), XTREAM_BASE_URL: 'https://provider.example',
      XTREAM_USERNAME: 'demo', XTREAM_PASSWORD: 'private', XTREAM_ENABLE_SERIES: 'false' }, pid: process.pid },
    Date: class extends Date { static now() { return now; } },
    fetch: async () => ({ ok: true, json: async () => Array.from({ length: 5 }, (_, i) =>
      ({ stream_id: i + 1, name: 'Moana - 2016', container_extension: 'mp4' })) }),
    URL, AbortSignal, setTimeout, clearTimeout, console,
  });
  try {
    vm.runInContext(readFileSync(join(__dirname, '../src/lounge-program.js'), 'utf8'), context);
    const program = context.module.exports;
    await assert.rejects(program.request({ lane: 'movie', itemId: 'xtream-vod-1' }), /currently unavailable/);
    assert.deepEqual(timeouts, [15000, 15000, 5000]);
    assert.equal(program.program().movie.current, null);
    assert.equal(now, 36000);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('an unplayable song searches five matching uploads before replying to chat', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-song-alternates-'));
  const previous = { ...process.env };
  try {
    process.env.LOUNGE_STATE_FILE = join(root, 'program.json');
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'yt-dlp'), `#!/bin/sh
case "$*" in
  *ytsearch5*) echo '{"entries":[{"id":"AAAAAAAAAAA","title":"Artist - Song"},{"id":"BBBBBBBBBBB","title":"Artist - Song"},{"id":"CCCCCCCCCCC","title":"Artist - Song"},{"id":"DDDDDDDDDDD","title":"Artist - Song"},{"id":"EEEEEEEEEEE","title":"Artist - Song"}]}' ;;
  *) echo '{"id":"ORIGINAL000","title":"Artist - Song","uploader":"Artist","duration":180}' ;;
esac
`, { mode: 0o755 });
    process.env.PATH = `${bin}:${previous.PATH}`;
    delete require.cache[require.resolve('../src/lounge-program')];
    const program = require('../src/lounge-program');
    const tried = [];
    program.configureMusicSource({ prepare: async id => { tried.push(id); return id === 'CCCCCCCCCCC'; }, failure: () => 'No compatible tracks', stop: () => {} });
    const found = await program.request({ lane: 'music', query: 'Artist - Song', actorName: 'listener' });
    assert.equal(found.request.item.metadata.videoId, 'CCCCCCCCCCC');
    assert.deepEqual(tried, ['ORIGINAL000', 'AAAAAAAAAAA', 'BBBBBBBBBBB', 'CCCCCCCCCCC']);
    program.configureMusicSource({ prepare: async id => { tried.push(id); return false; }, failure: () => 'No compatible tracks', stop: () => {} });
    await assert.rejects(program.request({ lane: 'music', query: 'Artist - Song', actorName: 'listener' }), /after checking the top five results/);
    assert.deepEqual(tried.slice(4), ['ORIGINAL000', 'AAAAAAAAAAA', 'BBBBBBBBBBB', 'CCCCCCCCCCC', 'DDDDDDDDDDD', 'EEEEEEEEEEE']);
    assert.equal(program.program().music.queueCount, 0);
  } finally {
    delete require.cache[require.resolve('../src/lounge-program')];
    Object.keys(process.env).forEach(key => { if (!(key in previous)) delete process.env[key]; });
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});

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
    writeFileSync(join(bin, 'yt-dlp'), '#!/bin/sh\ncase "$*" in *--flat-playlist*) echo \'{"entries":[{"id":"M7lc1UVf-VE","title":"Playlist Song","duration":120},{"id":"XXXXXXXXXXX","title":"Different Song","duration":120}]}\';; *) echo \'{"id":"dQw4w9WgXcQ","title":"Test Song","uploader":"Test Artist","duration":180}\';; esac\n', { mode: 0o755 });
    writeFileSync(join(bin, 'ffprobe'), '#!/bin/sh\necho \'{"streams":[{"codec_type":"video"}]}\'\n', { mode: 0o755 });
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
    await program.request({ lane: 'music', query: 'test song', actorName: 'viewer3' });
    assert.equal(program.program().music.current.requestId, music.request.requestId);
    assert.equal(JSON.parse(readFileSync(process.env.LOUNGE_STATE_FILE)).music.queue[0].requestId, queued.request.requestId);
    await program.control({ lane: 'music', control: 'next' });
    assert.equal(program.program().music.current.requestId, queued.request.requestId);
    await program.control({ lane: 'music', control: 'clear' });
    assert.equal(program.program().movie.playback.status, 'playing');
    const radio = await program.radio({ control: 'add', query: 'https://www.youtube.com/playlist?list=PLtest' });
    assert.equal(radio.radio.seedCount, 3);
    await program.radio({ control: 'on' });
    assert.equal(program.program().music.current, null, 'auto-radio must stay idle while a movie owns the Lounge');
    await program.control({ lane: 'movie', control: 'clear' });
    await program.radio({ control: 'on' });
    assert.equal(program.program().music.current.item.metadata.videoId, 'M7lc1UVf-VE');
    await program.control({ lane: 'music', control: 'next' });
    assert.equal(program.program().music.current.item.metadata.videoId, 'XXXXXXXXXXX');
    await program.tick(Date.now() + 181000);
    // M7 was manually skipped, so autoradio must not immediately recycle it.
    assert.equal(program.program().music.current.item.metadata.videoId, 'dQw4w9WgXcQ');
    assert.notEqual(program.program().music.current.item.metadata.videoId, 'M7lc1UVf-VE');
    assert.equal(program.program().radio.recentCount, 2);
    await program.radio({ control: 'off' });
    await program.control({ lane: 'music', control: 'next' });
    assert.equal(program.program().music.current, null);
  } finally {
    global.fetch = originalFetch;
    Object.keys(process.env).forEach(key => { if (!(key in previous)) delete process.env[key]; });
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test('Lounge radio imports an entire 480-song playlist without turning itself on', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-large-playlist-'));
  const previous = { ...process.env };
  try {
    process.env.LOUNGE_STATE_FILE = join(root, 'program.json');
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const entries = Array.from({ length: 480 }, (_, index) => ({ id: String(index).padStart(11, '0'), title: `Song ${index + 1}`, duration: 180 }));
    writeFileSync(join(bin, 'yt-dlp'), `#!/bin/sh\necho '${JSON.stringify({ entries })}'\n`, { mode: 0o755 });
    process.env.PATH = `${bin}:${previous.PATH}`;
    delete require.cache[require.resolve('../src/lounge-program')];
    const program = require('../src/lounge-program');
    const added = await program.radio({ control: 'add', query: 'https://youtube.com/playlist?list=PLYS-jRgAqcA7jEvh6YC-obbUUBxOJsfDS' });
    assert.equal(added.added, 480);
    assert.equal(program.program().radio.seedCount, 480);
    assert.equal(program.program().radio.enabled, false);
    await program.radio({ control: 'on' });
    const selected = new Set([program.program().music.current.item.metadata.videoId]);
    for (let index = 0; index < 12; index++) {
      await program.control({ lane: 'music', control: 'next' });
      selected.add(program.program().music.current.item.metadata.videoId);
    }
    assert.equal(selected.size, 13);
  } finally {
    Object.keys(process.env).forEach(key => { if (!(key in previous)) delete process.env[key]; });
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test('automatic handoff waits for a prepared feed and stops the previous conversion', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-radio-handoff-'));
  const previous = { ...process.env };
  try {
    process.env.LOUNGE_STATE_FILE = join(root, 'program.json');
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'yt-dlp'), `#!/bin/sh\necho '{"entries":[{"id":"AAAAAAAAAAA","title":"First","duration":90},{"id":"BBBBBBBBBBB","title":"Second","duration":120}]}'\n`, { mode: 0o755 });
    process.env.PATH = `${bin}:${previous.PATH}`;
    delete require.cache[require.resolve('../src/lounge-program')];
    const program = require('../src/lounge-program');
    let firstReady = true, secondReady = false;
    const stopped = [];
    program.configureMusicSource({
      isReady: id => id === 'AAAAAAAAAAA' ? firstReady : secondReady,
      prepare: async id => id === 'AAAAAAAAAAA' || secondReady,
      stop: id => stopped.push(id),
    });
    await program.radio({ control: 'add', query: 'https://youtube.com/playlist?list=PLtest' });
    await program.radio({ control: 'on' });
    const first = program.program().music.current;
    assert.equal(first.item.metadata.videoId, 'AAAAAAAAAAA');
    const now = Date.now();
    firstReady = false;
    await program.tick(now + 91000);
    assert.equal(program.program().music.current.requestId, first.requestId);
    firstReady = true;
    await program.tick(now + 92000);
    await program.tick(now + 183000);
    assert.equal(program.program().music.current.requestId, first.requestId);
    assert.deepEqual(stopped, []);
    secondReady = true;
    await program.tick(now + 184000);
    assert.equal(program.program().music.current.item.metadata.videoId, 'BBBBBBBBBBB');
    assert.deepEqual(stopped, ['AAAAAAAAAAA']);
  } finally {
    Object.keys(process.env).forEach(key => { if (!(key in previous)) delete process.env[key]; });
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test('manual skip removes the current song even when autoradio replacement is not ready', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-skip-immediate-'));
  const previous = { ...process.env };
  try {
    process.env.LOUNGE_STATE_FILE = join(root, 'program.json');
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'yt-dlp'), `#!/bin/sh
case "$*" in
  *--flat-playlist*) echo '{"entries":[{"id":"AAAAAAAAAAA","title":"First","duration":180},{"id":"BBBBBBBBBBB","title":"Second","duration":180}]}' ;;
  *) echo '{"id":"AAAAAAAAAAA","title":"First","duration":180}' ;;
esac
`, { mode: 0o755 });
    process.env.PATH = `${bin}:${previous.PATH}`;
    delete require.cache[require.resolve('../src/lounge-program')];
    const program = require('../src/lounge-program');
    const stopped = [];
    program.configureMusicSource({
      prepare: async id => id === 'AAAAAAAAAAA',
      failure: id => id === 'BBBBBBBBBBB' ? 'not ready' : '',
      stop: id => stopped.push(id),
    });
    await program.request({ lane: 'music', query: 'First', actorName: 'viewer' });
    await program.radio({ control: 'add', query: 'https://youtube.com/playlist?list=PLtest' });
    await program.radio({ control: 'on' });
    const before = program.program().music.current?.requestId;
    await program.control({ lane: 'music', control: 'next-active' });
    assert.notEqual(program.program().music.current?.requestId, before);
    assert.ok(stopped.includes('AAAAAAAAAAA'));
  } finally {
    delete require.cache[require.resolve('../src/lounge-program')];
    Object.keys(process.env).forEach(key => { if (!(key in previous)) delete process.env[key]; });
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test('radio follows human picks and never trains on its own selections', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-room-taste-'));
  const previous = { ...process.env };
  try {
    process.env.LOUNGE_STATE_FILE = join(root, 'program.json');
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'yt-dlp'), `#!/bin/sh
case "$*" in
  *ytsearch8*) echo '{"entries":[{"id":"RRRRRRRRRRR","title":"Related Song","duration":180}]}' ;;
  *--flat-playlist*) echo '{"entries":[{"id":"PPPPPPPPPPP","title":"Playlist Seed","duration":180}]}' ;;
  *AAAAAAAAAAA*) echo '{"id":"AAAAAAAAAAA","title":"Human Song A","uploader":"Room Artist","duration":180}' ;;
  *BBBBBBBBBBB*) echo '{"id":"BBBBBBBBBBB","title":"Human Song B","uploader":"Room Artist","duration":180}' ;;
  *CCCCCCCCCCC*) echo '{"id":"CCCCCCCCCCC","title":"Human Song C","uploader":"Room Artist","duration":180}' ;;
  *RRRRRRRRRRR*) echo '{"id":"RRRRRRRRRRR","title":"Related Song","uploader":"Other Artist","duration":180}' ;;
esac
`, { mode: 0o755 });
    process.env.PATH = `${bin}:${previous.PATH}`;
    delete require.cache[require.resolve('../src/lounge-program')];
    const program = require('../src/lounge-program');
    for (const id of ['AAAAAAAAAAA', 'BBBBBBBBBBB', 'CCCCCCCCCCC']) {
      await program.request({ lane: 'music', query: `https://www.youtube.com/watch?v=${id}`, actorName: 'viewer' });
      if (id !== 'AAAAAAAAAAA') await program.control({ lane: 'music', control: 'next' });
    }
    await program.radio({ control: 'add', query: 'https://youtube.com/playlist?list=PLtest' });
    await program.radio({ control: 'on' });
    assert.equal(program.program().radio.recentCount, 3);
    await program.control({ lane: 'music', control: 'next' });
    assert.equal(program.program().music.current.item.metadata.videoId, 'RRRRRRRRRRR');
    assert.equal(program.program().radio.recentCount, 3);
    await program.control({ lane: 'music', control: 'next' });
    assert.equal(program.program().music.current.item.metadata.videoId, 'BBBBBBBBBBB');
    assert.equal(program.program().radio.recentCount, 3);
    assert.notEqual(program.program().music.current.item.metadata.videoId, 'PPPPPPPPPPP');
  } finally {
    Object.keys(process.env).forEach(key => { if (!(key in previous)) delete process.env[key]; });
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});


test('clear cancels a song request still preparing and permits a newer request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-clear-pending-'));
  const previous = { ...process.env };
  try {
    process.env.LOUNGE_STATE_FILE = join(root, 'program.json');
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'yt-dlp'), '#!/bin/sh\necho \'{"id":"AAAAAAAAAAA","title":"Test Song","duration":180}\'\n', { mode: 0o755 });
    process.env.PATH = `${bin}:${previous.PATH}`;
    delete require.cache[require.resolve('../src/lounge-program')];
    const program = require('../src/lounge-program');
    let release, entered;
    const preparing = new Promise(resolve => { entered = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    let first = true;
    program.configureMusicSource({
      prepare: async () => {
        if (first) { first = false; entered(); await blocked; }
        return true;
      }, stop: () => {},
    });
    const request = program.request({ lane: 'music', query: 'Test Song', actorName: 'viewer' });
    const canceled = assert.rejects(request, /canceled by !clear/);
    await preparing;
    await program.control({ lane: 'music', control: 'clear' });
    release();
    await canceled;
    assert.equal(program.program().music.current, null);
    await program.request({ lane: 'music', query: 'Test Song', actorName: 'viewer' });
    assert.equal(program.program().music.current.item.title, 'Test Song');
  } finally {
    delete require.cache[require.resolve('../src/lounge-program')];
    Object.keys(process.env).forEach(key => { if (!(key in previous)) delete process.env[key]; });
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});


test('radio rejects alternate versions of the latest human-picked title', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-radio-title-dedupe-'));
  const previous = { ...process.env };
  try {
    process.env.LOUNGE_STATE_FILE = join(root, 'program.json');
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'yt-dlp'), `#!/bin/sh
case "$*" in
  *ytsearch8*) echo '{"entries":[
    {"id":"THUNDERLIVE","title":"AC/DC - Thunderstruck (Live at River Plate)","uploader":"AC/DC","duration":300},
    {"id":"OTHERSNG001","title":"AC/DC - Back In Black (Official Video)","uploader":"AC/DC","duration":255}
  ]}' ;;
  *THUNDER0001*) echo '{"id":"THUNDER0001","title":"AC/DC - Thunderstruck (Official Video)","uploader":"AC/DC","duration":292}' ;;
  *OTHERSNG001*) echo '{"id":"OTHERSNG001","title":"AC/DC - Back In Black (Official Video)","uploader":"AC/DC","duration":255}' ;;
esac
`, { mode: 0o755 });
    process.env.PATH = `${bin}:${previous.PATH}`;
    delete require.cache[require.resolve('../src/lounge-program')];
    const program = require('../src/lounge-program');
    await program.request({ lane: 'music', query: 'https://www.youtube.com/watch?v=THUNDER0001', actorName: 'viewer' });
    await program.radio({ control: 'on' });
    await program.control({ lane: 'music', control: 'next' });
    assert.equal(program.program().music.current.item.metadata.videoId, 'OTHERSNG001');
  } finally {
    Object.keys(process.env).forEach(key => { if (!(key in previous)) delete process.env[key]; });
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});


test('manual skip blacklists live and location variants of the skipped song family', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-skip-title-family-'));
  const previous = { ...process.env };
  try {
    process.env.LOUNGE_STATE_FILE = join(root, 'program.json');
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'yt-dlp'), `#!/bin/sh
case "$*" in
  *ytsearch8*) echo '{"entries":[
    {"id":"SAMEFAMILY1","title":"Artist - Bowl For Two Live in New York","uploader":"Artist","duration":180},
    {"id":"SAMEFAMILY2","title":"Artist - Bowl For Two Live in Florida","uploader":"Artist","duration":180},
    {"id":"DIFFERENT01","title":"Artist - Different Song","uploader":"Artist","duration":180}
  ]}' ;;
  *SKIPPED0001*) echo '{"id":"SKIPPED0001","title":"Artist - Bowl For Two","uploader":"Artist","duration":180}' ;;
  *DIFFERENT01*) echo '{"id":"DIFFERENT01","title":"Artist - Different Song","uploader":"Artist","duration":180}' ;;
  *) echo '{"id":"DIFFERENT01","title":"Artist - Different Song","uploader":"Artist","duration":180}' ;;
esac
`, { mode: 0o755 });
    process.env.PATH = `${bin}:${previous.PATH}`;
    delete require.cache[require.resolve('../src/lounge-program')];
    const program = require('../src/lounge-program');
    program.configureMusicSource({ prepare: async () => true, failure: () => '', stop: () => {} });
    await program.request({ lane: 'music', query: 'https://www.youtube.com/watch?v=SKIPPED0001', actorName: 'viewer' });
    await program.radio({ control: 'on' });
    await program.control({ lane: 'music', control: 'next-active' });
    assert.equal(program.program().music.current.item.metadata.videoId, 'DIFFERENT01');
  } finally {
    delete require.cache[require.resolve('../src/lounge-program')];
    Object.keys(process.env).forEach(key => { if (!(key in previous)) delete process.env[key]; });
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});


test('movie checkpoints persist forward progress without rewinding', () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-movie-checkpoint-'));
  const previous = { ...process.env };
  try {
    process.env.LOUNGE_STATE_FILE = join(root, 'program.json');
    writeFileSync(process.env.LOUNGE_STATE_FILE, JSON.stringify({
      movie: {
        current: {
          requestId: 'movie-request',
          requestedBy: { userId: 'owner', username: 'mtman1987' },
          addedAt: new Date(1000).toISOString(),
          item: { type: 'movie', title: 'Project Hail Mary - 2026', playbackUrl: '/api/watch/xtream/hls/vod-2643526/index.m3u8', metadata: { streamId: '2643526', extension: 'mp4', pathKind: 'movie' } },
        },
        queue: [],
        playback: { status: 'playing', position: 10, updatedAt: 1000, muted: false, volume: 85, seekRevision: 0 },
      },
      music: { current: null, queue: [], playback: { status: 'idle', position: 0, updatedAt: 1000, muted: false, volume: 85, seekRevision: 0 } },
      radio: { enabled: false, seeds: [], cursor: 0 },
    }));
    delete require.cache[require.resolve('../src/lounge-program')];
    const program = require('../src/lounge-program');
    assert.equal(program.checkpoint('movie', 'movie-request', 72, 61_000), true);
    let saved = JSON.parse(readFileSync(process.env.LOUNGE_STATE_FILE, 'utf8'));
    assert.equal(saved.movie.playback.position, 72);
    assert.equal(saved.movie.playback.updatedAt, 61_000);
    assert.equal(program.checkpoint('movie', 'wrong-request', 90, 62_000), false);
    assert.equal(program.checkpoint('movie', 'movie-request', 60, 62_000), false);
    saved = JSON.parse(readFileSync(process.env.LOUNGE_STATE_FILE, 'utf8'));
    assert.equal(saved.movie.playback.position, 72);
  } finally {
    delete require.cache[require.resolve('../src/lounge-program')];
    Object.keys(process.env).forEach(key => { if (!(key in previous)) delete process.env[key]; });
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test('direct Lounge HLS isolates cached segment URLs across movies and restarts', () => {
  const { rewriteManifestForGeneration, internalSegmentName } = require('../src/lounge-direct');
  const manifest = '#EXTM3U\n#EXTINF:4.000,\nsegment_000000.ts\n#EXTINF:4.000,\nsegment_000001.ts\n';
  const scary = rewriteManifestForGeneration(manifest, 'scary-request', 'capture-a');
  const hailMary = rewriteManifestForGeneration(manifest, 'hail-request', 'capture-b');
  const restarted = rewriteManifestForGeneration(manifest, 'hail-request', 'capture-c');

  assert.match(scary, /scary-request-capture-a-segment_000000\.ts/);
  assert.match(hailMary, /hail-request-capture-b-segment_000000\.ts/);
  assert.match(restarted, /hail-request-capture-c-segment_000000\.ts/);
  assert.notEqual(scary, hailMary);
  assert.notEqual(hailMary, restarted);

  assert.equal(
    internalSegmentName('hail-request-capture-b-segment_000001.ts', 'hail-request', 'capture-b'),
    'segment_000001.ts',
  );
  assert.equal(
    internalSegmentName('scary-request-capture-a-segment_000001.ts', 'hail-request', 'capture-b'),
    null,
  );
});


test('direct Lounge generation keys identify one immutable HLS timeline', () => {
  const { streamKeyForGeneration, rewriteManifestForGeneration, internalSegmentName } = require('../src/lounge-direct');
  const keyA = streamKeyForGeneration('movie-request', 'generation-a');
  const keyB = streamKeyForGeneration('movie-request', 'generation-b');
  assert.notEqual(keyA, keyB);
  assert.equal(keyA, 'movie-request-generation-a');
  const manifest = rewriteManifestForGeneration('#EXTM3U\nsegment_000007.ts\n', 'movie-request', 'generation-a');
  assert.match(manifest, /movie-request-generation-a-segment_000007\.ts/);
  assert.equal(internalSegmentName('movie-request-generation-a-segment_000007.ts', 'movie-request', 'generation-a'), 'segment_000007.ts');
  assert.equal(internalSegmentName('movie-request-generation-a-segment_000007.ts', 'movie-request', 'generation-b'), null);
});

test('movie requests reject broken sources and fallback only within the same title and year', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-movie-source-'));
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
    const probes = join(root, 'probes');
    writeFileSync(join(bin, 'ffprobe'), `#!/bin/sh
echo "$*" >> '${probes}'
case "$*" in
  *42.mp4*|*45.mp4*|*46.mp4*) echo 'moov atom not found' >&2; exit 1 ;;
  *) echo '{"streams":[{"codec_type":"video"},{"codec_type":"audio"}]}' ;;
esac
`, { mode: 0o755 });
    process.env.PATH = `${bin}:${previous.PATH}`;
    global.fetch = async () => ({ ok: true, json: async () => [
      { stream_id: 42, name: 'Moana - 2016', container_extension: 'mp4' },
      { stream_id: 43, name: 'Moana (2016)', container_extension: 'mkv' },
      { stream_id: 44, name: 'Moana 2 - 2024', container_extension: 'mp4' },
      { stream_id: 45, name: 'Moana (2026)', container_extension: 'mp4' },
      { stream_id: 46, name: 'Moana', year: '2016', container_extension: 'mp4' },
      { stream_id: 47, name: 'Moana', year: '2026', container_extension: 'mp4' },
      { stream_id: 48, name: 'Moana', year: '2016', container_extension: 'mkv' },
    ] });
    delete require.cache[require.resolve('../src/lounge-program')];
    const program = require('../src/lounge-program');
    const found = await program.request({ lane: 'movie', itemId: 'xtream-vod-42', actorName: 'viewer' });
    assert.equal(found.request.item.metadata.streamId, '43');
    assert.equal(found.request.item.metadata.extension, 'mkv');
    const firstId = program.program().movie.current.requestId;
    await assert.rejects(program.request({ lane: 'movie', itemId: 'xtream-vod-45' }),
      /Moana.*2026.*currently unavailable/);
    assert.equal(program.program().movie.current.requestId, firstId);
    assert.equal(program.program().movie.queueCount, 0);
    await program.request({ lane: 'movie', itemId: 'xtream-vod-42' });
    const attempted = readFileSync(probes, 'utf8').trim().split('\n');
    assert.equal(attempted.length, 3, 'probe results are cached per source');
    assert.ok(!attempted.some(line => line.includes('44.mp4')), 'never substitutes a sequel');
    const structuredYear = await program.request({ lane: 'movie', itemId: 'xtream-vod-46' });
    assert.equal(structuredYear.request.item.metadata.streamId, '48');
    assert.ok(!readFileSync(probes, 'utf8').includes('47.mp4'), 'never substitutes a different structured year');
  } finally {
    delete require.cache[require.resolve('../src/lounge-program')];
    global.fetch = originalFetch;
    Object.keys(process.env).forEach(key => { if (!(key in previous)) delete process.env[key]; });
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});

