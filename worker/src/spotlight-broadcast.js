const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { mkdir, mkdtemp, rm, access } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const SAFE_FILE = /^(?:index\.m3u8|spotlight_\d{6}\.ts)$/;

function createSpotlightBroadcast({ directory, chromiumPath, puppeteer, spotlightEndpoint = 'https://discord-stream-hub-new.fly.dev/api/community-spotlight' }) {
  let root, display, pulse, browser, page, host, encoder, startTask, active = false, activated = false, failure = '', currentLogin = '';
  const children = [];

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
    if (active && page && encoder && encoder.exitCode === null) return;
    if (startTask) return startTask;
    startTask = (async () => {
      failure = '';
      activated = false;
      currentLogin = '';
      await cleanup(true);
      root = await mkdtemp(join(tmpdir(), 'hmo-spotlight-source-'));
      await mkdir(directory, { recursive: true });

      display = child('Xvfb', ['-displayfd', '3', '-screen', '0', '1280x720x24', '-nolisten', 'tcp', '-ac'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
      const displayNumber = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(Error('The Spotlight display did not start')), 8000);
        display.once('error', () => { clearTimeout(timer); reject(Error('The Spotlight display is unavailable')); });
        display.stdio[3].on('data', bytes => {
          output += bytes.toString();
          if (/^\d+\s*$/.test(output) && output.includes('\n')) { clearTimeout(timer); resolve(output.trim()); }
        });
      });

      const socket = join(root, 'pulse.sock');
      const environment = { ...process.env, DISPLAY: ':' + displayNumber, PULSE_SERVER: 'unix:' + socket, PULSE_SINK: 'spotlight', XDG_RUNTIME_DIR: root, PULSE_RUNTIME_PATH: root, PULSE_STATE_PATH: root };
      pulse = child('pulseaudio', ['--daemonize=no', '--use-pid-file=no', '--exit-idle-time=-1', '--log-target=stderr', '--high-priority=no', '--realtime=no', '-n', '--load=module-native-protocol-unix socket=' + socket + ' auth-anonymous=1', '--load=module-null-sink sink_name=spotlight rate=48000 channels=2'], { env: environment });
      let audioReady = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        if (pulse.exitCode !== null || failure) break;
        try { await access(socket); audioReady = true; break; } catch { await delay(100); }
      }
      if (!audioReady) throw Error('The Spotlight audio device did not start');

      host = createServer((request, response) => {
        if (request.url !== '/') { response.writeHead(404); response.end(); return; }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'strict-origin-when-cross-origin' });
        response.end(sourcePage(spotlightEndpoint));
      });
      await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));

      browser = await puppeteer.launch({
        executablePath: chromiumPath, headless: false, defaultViewport: null,
        userDataDir: join(root, 'chromium'), env: environment,
        ignoreDefaultArgs: ['--mute-audio', '--enable-automation'],
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-infobars', '--kiosk', '--window-position=0,0', '--window-size=1280,720', '--force-device-scale-factor=1', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
      });
      browser.on('disconnected', () => { active = false; failure ||= 'The Spotlight browser disconnected'; });
      page = (await browser.pages())[0] || await browser.newPage();
      await page.goto('http://localhost:' + host.address().port + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => window.spotlightSource?.ready || window.spotlightSource?.error, { timeout: 30000 });
      const state = await page.evaluate(() => window.spotlightSource);
      if (state.error) throw Error(String(state.error));

      encoder = child('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
        '-thread_queue_size', '1024', '-f', 'x11grab', '-draw_mouse', '0', '-video_size', '1280x720', '-framerate', '30', '-i', ':' + displayNumber + '.0',
        '-thread_queue_size', '1024', '-f', 'pulse', '-sample_rate', '48000', '-channels', '2', '-i', 'spotlight.monitor',
        '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-threads', '4', '-preset', 'superfast', '-tune', 'zerolatency', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-af', 'aresample=async=1:first_pts=0',
        '-f', 'hls', '-hls_time', '1', '-hls_list_size', '20', '-hls_delete_threshold', '8', '-hls_flags', 'delete_segments+omit_endlist+independent_segments+temp_file',
        '-hls_segment_filename', join(directory, 'spotlight_%06d.ts'), join(directory, 'index.m3u8')], { env: environment });
      encoder.on('error', () => { active = false; failure ||= 'The Spotlight recorder could not start'; });
      encoder.once('close', code => { active = false; if (code !== 0) failure ||= 'The Spotlight recorder stopped'; });
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
    if (!page) throw Error('The Spotlight source is unavailable');
    await page.click('#start');
    await page.waitForFunction(() => window.spotlightSource?.activated === true, { timeout: 10000 });
    const state = await page.evaluate(() => ({ activated: window.spotlightSource?.activated === true, currentLogin: window.spotlightSource?.currentLogin || '' }));
    activated = state.activated;
    currentLogin = state.currentLogin;
    return status();
  }

  async function consent() {
    await ensureSource();
    if (!page) throw Error('The Spotlight source is unavailable');
    let clicked = false;
    for (const frame of page.frames()) {
      const direct = await frame.$('[data-a-target="content-classification-gate-overlay-start-watching-button"]').catch(() => null);
      if (direct) {
        await direct.click().catch(() => {});
        clicked = true;
        break;
      }
      const frameClicked = await frame.evaluate(() => {
        for (const button of Array.from(document.querySelectorAll('button'))) {
          const label = String(button.textContent || button.getAttribute('aria-label') || '').trim();
          if (!/^(?:start watching|continue watching|watch anyway)$/i.test(label)) continue;
          button.click();
          return true;
        }
        return false;
      }).catch(() => false);
      if (frameClicked) clicked = true;
      if (clicked) break;
    }
    if (clicked) await delay(350);
    return { ...(await status()), warningCleared: clicked };
  }

  async function status() {
    if (page && active) {
      try {
        const state = await page.evaluate(() => ({
          activated: window.spotlightSource?.activated === true,
          currentLogin: window.spotlightSource?.currentLogin || '',
          error: window.spotlightSource?.error || '',
          playbackPosition: Number(window.spotlightSource?.playbackPosition || 0),
          stalledForMs: Number(window.spotlightSource?.stalledForMs || 0),
          recoveryCount: Number(window.spotlightSource?.recoveryCount || 0),
          lastRecoveryReason: window.spotlightSource?.lastRecoveryReason || '',
          quality: window.spotlightSource?.quality || '',
        }));
        activated = state.activated; currentLogin = state.currentLogin; if (state.error) failure = String(state.error);
        return { configured: true, active, activated, currentLogin, ready: active && activated && existsSync(join(directory, 'index.m3u8')), error: failure || null, ...state };
      } catch {}
    }
    return { configured: true, active, activated, currentLogin, ready: active && activated && existsSync(join(directory, 'index.m3u8')), error: failure || null };
  }

  function file(name) {
    if (!SAFE_FILE.test(String(name || ''))) return null;
    const path = join(directory, name);
    return existsSync(path) ? path : null;
  }

  async function cleanup(removeRoot = true) {
    active = false;
    await stopProcess(encoder); encoder = undefined;
    await browser?.close().catch(() => {}); browser = undefined; page = undefined;
    await Promise.all(children.splice(0).map(stopProcess));
    if (host) { host.closeAllConnections(); await new Promise(resolve => host.close(resolve)); host = undefined; }
    if (removeRoot && root) await rm(root, { recursive: true, force: true });
    root = undefined; display = undefined; pulse = undefined;
  }

  return { start, consent, status, file, close: () => cleanup(true) };
}

function sourcePage(endpoint) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#player{margin:0;width:100%;height:100%;overflow:hidden;background:#000}iframe{border:0}#start{position:fixed;z-index:5;left:50%;top:50%;transform:translate(-50%,-50%);padding:18px 28px;font:700 18px system-ui}</style></head><body><div id="player"></div><button id="start" type="button">Start Spotlight</button><script src="https://player.twitch.tv/js/embed/v1.js"></script><script>
window.spotlightSource={ready:false,activated:false,currentLogin:'',error:'',playbackPosition:0,stalledForMs:0,recoveryCount:0,lastRecoveryReason:'',quality:''};
let player=null,currentLogin='',activated=false,switching=false,lastPosition=-1,lastProgressAt=Date.now(),lastRecoveryAt=0;
const endpoint=${JSON.stringify(endpoint)},button=document.getElementById('start');
function audio(){if(!player||!activated)return;try{player.setVolume(.58);player.setMuted(false);player.play()}catch{}}
function stableQuality(){
 if(!player)return;
 try{
  const qualities=typeof player.getQualities==='function'?player.getQualities():[];
  const groups=(qualities||[]).map(q=>String(q?.group||q?.name||'')).filter(Boolean);
  const preferred=groups.find(q=>/^720p$/i.test(q))||groups.find(q=>/^480p(?:30)?$/i.test(q))||groups.find(q=>/^720p/i.test(q))||'auto';
  if(typeof player.setQuality==='function')player.setQuality(preferred);
  window.spotlightSource.quality=preferred;
 }catch{}
}
function playBootstrap(){if(!player)return;try{stableQuality();player.setVolume(.58);player.setMuted(!activated);player.play()}catch{}}
function resetProgressClock(){
 lastPosition=-1;
 lastProgressAt=Date.now();
 window.spotlightSource.playbackPosition=0;
 window.spotlightSource.stalledForMs=0;
}
function recover(reason){
 if(!player||!currentLogin||!activated)return;
 const now=Date.now();
 if(now-lastRecoveryAt<8000)return;
 lastRecoveryAt=now;
 window.spotlightSource.recoveryCount++;
 window.spotlightSource.lastRecoveryReason=reason;
 switching=true;
 try{player.pause()}catch{}
 setTimeout(()=>{
  try{player.setChannel(currentLogin)}catch{}
  resetProgressClock();
  playBootstrap();
  audio();
  [500,1500,3000].forEach(ms=>setTimeout(()=>{playBootstrap();audio()},ms));
 },150);
}
function mount(login){
 const clean=String(login||'').replace(/^@/,'').trim().toLowerCase();
 if(!clean)return;
 if(clean===currentLogin&&player)return;
 currentLogin=clean;window.spotlightSource.currentLogin=clean;switching=true;resetProgressClock();
 if(player){try{player.setChannel(clean)}catch{};playBootstrap();[350,1200,2500,4000].forEach(ms=>setTimeout(()=>{playBootstrap();audio()},ms));return}
 player=new Twitch.Player('player',{channel:clean,parent:[location.hostname],autoplay:true,muted:true,controls:false,width:'100%',height:'100%'});
 player.addEventListener(Twitch.Player.READY,()=>{window.spotlightSource.ready=true;resetProgressClock();stableQuality();playBootstrap()});
 player.addEventListener(Twitch.Player.PLAY,()=>{switching=false;lastProgressAt=Date.now();audio()});
 player.addEventListener(Twitch.Player.PLAYING,()=>{switching=false;lastProgressAt=Date.now();stableQuality();audio();setTimeout(audio,250);setTimeout(audio,1000)});
 player.addEventListener(Twitch.Player.PAUSE,()=>{if(switching)setTimeout(playBootstrap,300)});
 player.addEventListener(Twitch.Player.PLAYBACK_BLOCKED,()=>recover('playback-blocked'));
 player.addEventListener(Twitch.Player.OFFLINE,()=>{currentLogin='';window.spotlightSource.currentLogin=''});
}
function watchPlayback(){
 if(!player||!activated||!currentLogin)return;
 let position=0,paused=false;
 try{position=Number(player.getCurrentTime?.()||0);paused=Boolean(player.isPaused?.())}catch{return}
 const now=Date.now();
 window.spotlightSource.playbackPosition=position;
 if(position>lastPosition+.20){
  lastPosition=position;
  lastProgressAt=now;
  window.spotlightSource.stalledForMs=0;
  return;
 }
 const stalledFor=now-lastProgressAt;
 window.spotlightSource.stalledForMs=stalledFor;
 if(!paused&&!switching&&stalledFor>=12000)recover('playback-clock-stalled');
}
button.addEventListener('click',()=>{activated=true;window.spotlightSource.activated=true;button.remove();resetProgressClock();playBootstrap();audio();[150,500,1000].forEach(ms=>setTimeout(audio,ms))});
async function refresh(){try{const r=await fetch(endpoint,{cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)throw Error('spotlight '+r.status);const data=await r.json(),login=data?.spotlight?.twitchLogin||data?.spotlight?.user?.twitchLogin||'';if(!login){window.spotlightSource.error='No live community Spotlight is available';return}window.spotlightSource.error='';mount(login)}catch(error){window.spotlightSource.error=String(error?.message||error)}}
refresh();setInterval(refresh,5000);setInterval(watchPlayback,2000);
</script></body></html>`;
}

module.exports = { createSpotlightBroadcast };