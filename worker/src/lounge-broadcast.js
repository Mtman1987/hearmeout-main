const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { mkdtemp, rm, access, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createLoungeBroadcast({ chromiumPath, puppeteer, sourceUrl }) {
  let root, display, pulse, browser, page, encoder, startTask, active = false, failure = '', lastFragmentAt = 0;
  let init = Buffer.alloc(0), pending = Buffer.alloc(0), fragment = [], fragmentsSent = 0;
  const viewers = new Set();
  const children = [];
  const profileDir = process.env.LOUNGE_PROFILE_DIR || (process.env.FLY_APP_NAME ? '/data/lounge-chromium' : join(tmpdir(), 'hmo-lounge-chromium'));

  function child(command, args, options = {}) {
    const proc = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], ...options });
    children.push(proc);
    proc.stderr?.resume();
    proc.on('error', error => { failure ||= error.message || String(error); });
    return proc;
  }

  async function stopProcess(proc) {
    if (!proc?.pid || proc.exitCode !== null || proc.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => proc.kill('SIGKILL'), 1500);
      proc.once('close', () => { clearTimeout(timer); resolve(); });
      proc.kill('SIGTERM');
    });
  }

  async function ensureSource() {
    if (active && page && encoder && encoder.exitCode === null && Date.now() - lastFragmentAt < 15000) return;
    if (startTask) return startTask;
    startTask = (async () => {
      failure = '';
      await cleanup(true);
      init = Buffer.alloc(0); pending = Buffer.alloc(0); fragment = []; fragmentsSent = 0; lastFragmentAt = 0;
      root = await mkdtemp(join(tmpdir(), 'hmo-lounge-source-'));

      display = child('Xvfb', ['-displayfd', '3', '-screen', '0', '1280x720x24', '-nolisten', 'tcp', '-ac'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
      const displayNumber = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(Error('The Lounge display did not start')), 8000);
        display.once('error', () => { clearTimeout(timer); reject(Error('The Lounge display is unavailable')); });
        display.stdio[3].on('data', bytes => {
          output += bytes.toString();
          if (/^\d+\s*$/.test(output) && output.includes('\n')) { clearTimeout(timer); resolve(output.trim()); }
        });
      });

      const socket = join(root, 'pulse.sock');
      const environment = { ...process.env, DISPLAY: ':' + displayNumber, PULSE_SERVER: 'unix:' + socket, PULSE_SINK: 'lounge', XDG_RUNTIME_DIR: root, PULSE_RUNTIME_PATH: root, PULSE_STATE_PATH: root };
      pulse = child('pulseaudio', ['--daemonize=no', '--use-pid-file=no', '--exit-idle-time=-1', '--log-target=stderr', '--high-priority=no', '--realtime=no', '-n', '--load=module-native-protocol-unix socket=' + socket + ' auth-anonymous=1', '--load=module-null-sink sink_name=lounge rate=48000 channels=2'], { env: environment });
      let audioReady = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (pulse.exitCode !== null) break;
        try {
          await access(socket);
          audioReady = true;
          break;
        } catch {
          await delay(100);
        }
      }
      if (!audioReady) {
        const exitDetail = pulse.exitCode !== null ? ` (pulseaudio exited ${pulse.exitCode})` : '';
        throw Error('The Lounge audio device did not start' + exitDetail);
      }

      await mkdir(profileDir, { recursive: true });
      browser = await puppeteer.launch({
        executablePath: chromiumPath,
        headless: false,
        defaultViewport: null,
        userDataDir: profileDir,
        env: environment,
        ignoreDefaultArgs: ['--mute-audio', '--enable-automation'],
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-infobars',
          '--kiosk',
          '--window-position=0,0',
          '--window-size=1280,720',
          '--force-device-scale-factor=1',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
        ],
      });
      browser.on('disconnected', () => { active = false; failure ||= 'The Lounge browser disconnected'; });
      page = (await browser.pages())[0] || await browser.newPage();
      await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await delay(1200);
      await page.mouse.click(640, 360).catch(() => {});

      encoder = child('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-thread_queue_size', '1024',
        '-f', 'x11grab', '-draw_mouse', '0', '-video_size', '1280x720', '-framerate', '30', '-i', ':' + displayNumber + '.0',
        '-thread_queue_size', '1024',
        '-f', 'pulse', '-sample_rate', '48000', '-channels', '2', '-i', 'lounge.monitor',
        '-map', '0:v:0', '-map', '1:a:0',
        '-vf', 'scale=854:480',
        '-c:v', 'libx264', '-profile:v', 'baseline', '-level:v', '3.1',
        '-threads', '3', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '27',
        '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-af', 'aresample=async=1:first_pts=0',
        '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1',
      ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });

      encoder.stdout.on('data', acceptBytes);
      encoder.on('error', () => { active = false; failure ||= 'The Lounge recorder could not start'; });
      encoder.once('close', code => { active = false; if (code !== 0) failure ||= 'The Lounge recorder stopped'; });
      active = true;
    })().catch(async error => {
      failure = error.message || String(error);
      await cleanup(true);
      throw error;
    }).finally(() => { startTask = undefined; });
    return startTask;
  }

  async function start() {
    await ensureSource();
    return status();
  }

  async function status() {
    let mediaTitle = '', playerMode = '', mediaHealthy = false;
    if (page && active) {
      try {
        const state = await page.evaluate(() => {
          const root = document.querySelector('[data-testid="overlay-root"]');
          return {
            title: root?.getAttribute('data-media-title') || '',
            mode: root?.getAttribute('data-player-mode') || '',
            healthy: root?.getAttribute('data-media-healthy') === 'true',
          };
        });
        mediaTitle = state.title;
        playerMode = state.mode;
        mediaHealthy = state.healthy;
      } catch {}
    }
    return {
      configured: true,
      active,
      ready: active && fragmentsSent > 0 && Date.now() - lastFragmentAt < 15000,
      fragmentsSent,
      mediaTitle,
      playerMode,
      mediaHealthy,
      viewers: viewers.size,
      error: failure || null,
    };
  }

  async function cleanup(removeRoot = true) {
    active = false;
    for (const response of viewers) response.end();
    viewers.clear();
    await stopProcess(encoder); encoder = undefined;
    await browser?.close().catch(() => {}); browser = undefined; page = undefined;
    await Promise.all(children.splice(0).map(stopProcess));
    if (removeRoot && root) await rm(root, { recursive: true, force: true });
    root = undefined; display = undefined; pulse = undefined;
  }

  function acceptBytes(bytes) {
    pending = pending.length ? Buffer.concat([pending, bytes]) : bytes;
    while (pending.length >= 8) {
      const size = pending.readUInt32BE(0);
      if (size < 8 || size > 16 * 1024 * 1024) { failure = 'Invalid Lounge fragment'; encoder?.kill(); return; }
      if (pending.length < size) return;
      const box = pending.subarray(0, size);
      pending = pending.subarray(size);
      const type = box.toString('ascii', 4, 8);
      if (!fragmentsSent && !fragment.length && type !== 'moof') init = Buffer.concat([init, box]);
      else {
        fragment.push(box);
        if (type === 'mdat') {
          const payload = Buffer.concat(fragment); fragment = [];
          fragmentsSent++; lastFragmentAt = Date.now();
          for (const response of viewers) {
            // A false write result means Node has queued data, not that the viewer
            // disconnected. Only drop a viewer whose actual backlog exceeds
            // the cap; normal MP4 fragments often exceed the socket high water mark.
            if (response.destroyed || response.writableLength > 8 * 1024 * 1024) {
              viewers.delete(response);
              response.end();
            } else {
              response.write(framePacket(payload));
            }
          }
        }
      }
    }
  }

  function watch(response) {
    if (!fragmentsSent || !init.length || !active) return false;
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store, no-transform',
      'x-content-type-options': 'nosniff',
      'x-accel-buffering': 'no',
    });
    response.write(framePacket(init));
    viewers.add(response);
    response.on('close', () => viewers.delete(response));
    return true;
  }

  return { start, status, watch, close: () => cleanup(true) };
}

function framePacket(payload) {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(payload.length);
  return Buffer.concat([length, payload]);
}

module.exports = { createLoungeBroadcast };
