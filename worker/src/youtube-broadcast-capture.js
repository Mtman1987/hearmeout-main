const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { mkdtemp, mkdir, rm, access } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const active = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// This browser is a source appliance owned by the worker, never a viewing
// window. Its private display and audio sink are recorded once into reusable
// HLS. HTTP disconnects do not cancel this job.
async function captureYoutubeBroadcast({ videoId, directory, indexPath, chromiumPath, puppeteer, onEncoder }) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw Error('Invalid YouTube video');
  if (active.size >= 2) throw Error('Two YouTube sources are already being saved. Retry when one finishes.');
  const job = {};
  active.add(job);
  let root, display, pulse, browser, host, encoder, encoderDone, encoderFailure = '', shuttingDown = false;
  const children = [];
  function child(command, args, options = {}) {
    const process = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], ...options });
    children.push(process);
    process.on('error', () => { encoderFailure ||= 'The shared YouTube player could not start a required capture process'; });
    process.stderr?.resume();
    return process;
  }
  async function stop(process) {
    if (!process?.pid || process.exitCode !== null || process.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => process.kill('SIGKILL'), 1500);
      process.once('close', () => { clearTimeout(timer); resolve(); });
      process.kill('SIGTERM');
    });
  }
  try {
    root = await mkdtemp(join(tmpdir(), 'hmo-youtube-source-'));
    await mkdir(directory, { recursive: true });
    display = child('Xvfb', ['-displayfd', '3', '-screen', '0', '1280x720x24', '-nolisten', 'tcp', '-ac'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
    const displayNumber = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(Error('The shared YouTube display did not start')), 8000);
      display.once('error', () => { clearTimeout(timer); reject(Error('The shared YouTube display is unavailable')); });
      display.stdio[3].on('data', bytes => {
        output += bytes.toString();
        if (/^\d+\s*$/.test(output) && output.includes('\n')) { clearTimeout(timer); resolve(output.trim()); }
      });
    });
    const socket = join(root, 'pulse.sock');
    const environment = { ...process.env, DISPLAY: ':' + displayNumber, PULSE_SERVER: 'unix:' + socket, PULSE_SINK: 'hmo', XDG_RUNTIME_DIR: root, PULSE_RUNTIME_PATH: root, PULSE_STATE_PATH: root };
    pulse = child('pulseaudio', ['--daemonize=no', '--use-pid-file=no', '--exit-idle-time=-1', '--log-target=stderr', '--high-priority=no', '--realtime=no', '-n', '--load=module-native-protocol-unix socket=' + socket + ' auth-anonymous=1', '--load=module-null-sink sink_name=hmo rate=48000 channels=2'], { env: environment });
    let audioReady = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (pulse.exitCode !== null || encoderFailure) break;
      try { await access(socket); audioReady = true; break; } catch { await delay(100); }
    }
    if (!audioReady) throw Error('The shared YouTube audio device did not start');
    host = createServer((request, response) => {
      if (request.url !== '/') { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'strict-origin-when-cross-origin' });
      response.end(sourcePage(videoId));
    });
    await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({
      executablePath: chromiumPath, headless: false, defaultViewport: null,
      userDataDir: join(root, 'chromium'), env: environment,
      // Puppeteer's default mute flag would otherwise produce silent captures.
      ignoreDefaultArgs: ['--mute-audio'],
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--kiosk', '--window-position=0,0', '--window-size=1280,720', '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    });
    browser.on('disconnected', () => { if (!shuttingDown) encoderFailure ||= 'The shared YouTube player disconnected'; });
    const page = (await browser.pages())[0] || await browser.newPage();
    await page.goto('http://127.0.0.1:' + host.address().port + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.hmoCapture?.ready || window.hmoCapture?.error, { timeout: 30000 }).catch(() => { throw Error('YouTube did not load in the shared source player'); });
    let state = await page.evaluate(() => window.hmoCapture);
    if (state.error) throw Error('YouTube refused the shared source player (player error ' + state.error + ')');
    await page.evaluate(() => window.hmoPlayer.playVideo());
    await page.waitForFunction(() => window.hmoCapture?.playing || window.hmoCapture?.error, { timeout: 30000 }).catch(() => { throw Error('YouTube did not permit playback in the shared source player'); });
    state = await page.evaluate(() => window.hmoCapture);
    if (state.error) throw Error('YouTube refused the shared source player (player error ' + state.error + ')');
    // Confirm actual playback before recording, then return to the beginning.
    await page.evaluate(() => { window.hmoPlayer.pauseVideo(); window.hmoPlayer.seekTo(0, true); });
    await page.waitForFunction(() => window.hmoPlayer.getPlayerState() === 2, { timeout: 5000 });
    await page.evaluate(() => { window.hmoCapture.ended = false; });
    encoder = child('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-thread_queue_size', '512', '-f', 'x11grab', '-draw_mouse', '0', '-video_size', '1280x720', '-framerate', '24', '-i', ':' + displayNumber + '.0',
      '-thread_queue_size', '512', '-f', 'pulse', '-sample_rate', '48000', '-channels', '2', '-i', 'hmo.monitor',
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-g', '48',
      '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-af', 'aresample=async=1:first_pts=0',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'event', '-hls_flags', 'independent_segments+temp_file',
      '-hls_segment_filename', join(directory, 'capture_%06d.ts'), indexPath], { env: environment, stdio: ['pipe', 'ignore', 'pipe'] });
    const storageFailure = onEncoder?.(encoder, directory);
    encoderDone = new Promise(resolve => encoder.once('close', code => resolve(code)));
    encoder.on('error', () => { encoderFailure = 'The shared YouTube recorder could not start'; });
    encoder.stdin.on('error', () => {});
    await page.evaluate(() => window.hmoPlayer.playVideo());
    const deadline = Date.now() + 3 * 60 * 60 * 1000;
    let lastPosition = -1, lastProgress = Date.now();
    while (true) {
      if (encoderFailure || storageFailure?.()) throw Error(encoderFailure || storageFailure());
      if (encoder.exitCode !== null || encoder.signalCode !== null) throw Error('The shared YouTube recorder stopped before the source ended');
      state = await page.evaluate(() => ({ ...window.hmoCapture, position: window.hmoPlayer.getCurrentTime() }));
      if (state.error) throw Error('YouTube refused the shared source player (player error ' + state.error + ')');
      if (state.ended) break;
      if (state.position > lastPosition + 0.05) { lastPosition = state.position; lastProgress = Date.now(); }
      if (Date.now() - lastProgress > 45000) throw Error('The shared YouTube source stalled for 45 seconds');
      if (Date.now() > deadline) throw Error('The shared YouTube source exceeded the three-hour capture limit');
      await delay(500);
    }
    encoder.stdin.end('q\n');
    const completed = await Promise.race([encoderDone, delay(10000).then(() => 'timeout')]);
    if (completed !== 0) throw Error('The shared YouTube recording did not finish cleanly');
  } finally {
    shuttingDown = true;
    // Stop the encoder before tearing down its display/audio devices.
    await stop(encoder);
    await browser?.close().catch(() => {});
    await Promise.all(children.filter(process => process !== encoder).map(stop));
    if (host) { host.closeAllConnections(); await new Promise(resolve => host.close(resolve)); }
    if (root) await rm(root, { recursive: true, force: true });
    active.delete(job);
  }
}

function sourcePage(videoId) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#player{margin:0;width:100%;height:100%;overflow:hidden;background:black}iframe{border:0}</style></head><body><div id="player"></div><script>
window.hmoCapture={ready:false,playing:false,ended:false,error:0};
window.onYouTubeIframeAPIReady=function(){window.hmoPlayer=new YT.Player('player',{videoId:${JSON.stringify(videoId)},width:'100%',height:'100%',playerVars:{autoplay:0,controls:0,disablekb:1,fs:0,playsinline:1,origin:location.origin},events:{onReady:function(){window.hmoCapture.ready=true;},onError:function(event){window.hmoCapture.error=Number(event.data)||1;},onStateChange:function(event){window.hmoCapture.playing=event.data===1;if(event.data===0)window.hmoCapture.ended=true;}}});};
</script><script src="https://www.youtube.com/iframe_api"></script></body></html>`;
}
module.exports = { captureYoutubeBroadcast };
