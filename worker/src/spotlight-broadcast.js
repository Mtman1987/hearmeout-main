const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { mkdtemp, rm, access, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createSpotlightBroadcast({ chromiumPath, puppeteer, spotlightEndpoint = 'https://discord-stream-hub-new.fly.dev/api/community-spotlight' }) {
  let root, display, pulse, browser, page, host, encoder, startTask, activationTask, warningTimer, active = false, activated = false, failure = '', currentLogin = '';
  let init = Buffer.alloc(0), pending = Buffer.alloc(0), fragment = [], fragmentsSent = 0, lastFragmentAt = 0;
  const viewers = new Set();
  const children = [];
  const profileDir = process.env.SPOTLIGHT_PROFILE_DIR || (process.env.FLY_APP_NAME ? '/data/spotlight-chromium' : join(tmpdir(), 'hmo-spotlight-chromium'));

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
      activated = false;
      currentLogin = '';
      await cleanup(true);
      init = Buffer.alloc(0); pending = Buffer.alloc(0); fragment = []; fragmentsSent = 0; lastFragmentAt = 0;
      root = await mkdtemp(join(tmpdir(), 'hmo-spotlight-source-'));

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

      await mkdir(profileDir, { recursive: true });
      browser = await puppeteer.launch({
        executablePath: chromiumPath, headless: false, defaultViewport: null,
        userDataDir: profileDir, env: environment,
        ignoreDefaultArgs: ['--mute-audio', '--enable-automation'],
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-infobars', '--kiosk', '--window-position=0,0', '--window-size=1280,720', '--force-device-scale-factor=1', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
      });
      browser.on('disconnected', () => { active = false; failure ||= 'The Spotlight browser disconnected'; });
      page = (await browser.pages())[0] || await browser.newPage();
      await page.goto('http://localhost:' + host.address().port + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      // The persistent source can be healthy before Twitch's embed reports READY.
      // Do not tear down Xvfb/PulseAudio/Chromium just because the Twitch script,
      // API poll, or player bootstrap takes longer than 30 seconds.
      await page.waitForFunction(() => Boolean(window.spotlightSource), { timeout: 5000 });
      const state = await page.evaluate(() => window.spotlightSource);
      if (!warningTimer) {
        warningTimer = setInterval(() => { if (activated) void clearContentWarning().catch(() => {}); }, 3000);
        warningTimer.unref?.();
      }
      // An empty rotation is still a running source. Its page keeps polling
      // until a creator becomes live, without needing another viewer click.

      encoder = child('ffmpeg', ['-hide_banner', '-loglevel', 'error',
        '-thread_queue_size', '1024', '-f', 'x11grab', '-draw_mouse', '0', '-video_size', '1280x720', '-framerate', '30', '-i', ':' + displayNumber + '.0',
        '-thread_queue_size', '1024', '-f', 'pulse', '-sample_rate', '48000', '-channels', '2', '-i', 'spotlight.monitor',
        '-map', '0:v:0', '-map', '1:a:0', '-vf', 'scale=854:480', '-c:v', 'libx264', '-profile:v', 'baseline', '-level:v', '3.1', '-threads', '3', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '28', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-af', 'aresample=async=1:first_pts=0',
        '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1'],
      { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
      encoder.stdout.on('data', acceptBytes);
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
    if (!activated) {
      if (!activationTask) activationTask = (async () => {
        await page.click('#start');
        await page.waitForFunction(() => window.spotlightSource?.activated === true, { timeout: 10000 });
      })().finally(() => { activationTask = undefined; });
      await activationTask;
    }
    const state = await page.evaluate(() => ({ activated: window.spotlightSource?.activated === true, currentLogin: window.spotlightSource?.currentLogin || '' }));
    activated = state.activated;
    currentLogin = state.currentLogin;
    await clearContentWarning().catch(() => false);
    return status();
  }

  async function clearContentWarning() {
    if (!page) return false;
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
    return clicked;
  }

  async function consent() {
    await ensureSource();
    if (!page) throw Error('The Spotlight source is unavailable');
    const clicked = await clearContentWarning();
    return { ...(await status()), warningCleared: clicked };
  }

  async function status() {
    if (page && active) {
      try {
        const state = await page.evaluate(() => ({
          activated: window.spotlightSource?.activated === true,
          currentLogin: window.spotlightSource?.currentLogin || '',
          error: window.spotlightSource?.error || '',
          fps: Number(window.spotlightSource?.fps || 0),
          bufferSize: Number(window.spotlightSource?.bufferSize || 0),
          playbackRate: Number(window.spotlightSource?.playbackRate || 0),
          skippedFrames: Number(window.spotlightSource?.skippedFrames || 0),
          stalledForMs: Number(window.spotlightSource?.stalledForMs || 0),
          recoveryCount: Number(window.spotlightSource?.recoveryCount || 0),
          lastRecoveryReason: window.spotlightSource?.lastRecoveryReason || '',
          quality: window.spotlightSource?.quality || '',
        }));
        activated = state.activated; currentLogin = state.currentLogin; if (state.error) failure = String(state.error);
        return { configured: true, active, activated, currentLogin, ready: active && activated && fragmentsSent > 0 && Date.now() - lastFragmentAt < 15000, fragmentsSent, error: failure || null, ...state };
      } catch {}
    }
    return { configured: true, active, activated, currentLogin, ready: active && activated && fragmentsSent > 0 && Date.now() - lastFragmentAt < 15000, fragmentsSent, error: failure || null };
  }

  async function cleanup(removeRoot = true) {
    active = false;
    if (warningTimer) { clearInterval(warningTimer); warningTimer = undefined; }
    for (const response of viewers) response.end();
    viewers.clear();
    await stopProcess(encoder); encoder = undefined;
    await browser?.close().catch(() => {}); browser = undefined; page = undefined;
    await Promise.all(children.splice(0).map(stopProcess));
    if (host) { host.closeAllConnections(); await new Promise(resolve => host.close(resolve)); host = undefined; }
    if (removeRoot && root) await rm(root, { recursive: true, force: true });
    root = undefined; display = undefined; pulse = undefined;
  }

  // Fragmented MP4 has one init section, followed by independent fragments.
  // Each new HTTP viewer gets the init section and only future fragments.
  // A slow viewer is disconnected instead of holding the source behind it.
  function acceptBytes(bytes) {
    pending = pending.length ? Buffer.concat([pending, bytes]) : bytes;
    while (pending.length >= 8) {
      const size = pending.readUInt32BE(0);
      if (size < 8 || size > 16 * 1024 * 1024) { failure = 'Invalid Spotlight fragment'; encoder?.kill(); return; }
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
            if (!response.write(framePacket(payload))) { viewers.delete(response); response.end(); }
          }
        }
      }
    }
  }

  function watch(response) {
    if (!fragmentsSent || !init.length || !active) return false;
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store, no-transform', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no' });
    response.write(framePacket(init));
    viewers.add(response);
    response.on('close', () => viewers.delete(response));
    return true;
  }

  return { start, consent, status, watch, close: () => cleanup(true) };
}

function framePacket(payload) {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(payload.length);
  return Buffer.concat([length, payload]);
}

function sourcePage(endpoint) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#player,#spotlight-twitch-player,#player>div,#player iframe{margin:0;width:100%;height:100%;min-width:100%;min-height:100%;overflow:hidden;background:#000;box-sizing:border-box}iframe{display:block;border:0}#start{position:fixed;z-index:5;left:50%;top:50%;transform:translate(-50%,-50%);padding:18px 28px;font:700 18px system-ui}</style></head><body><div id="player"></div><button id="start" type="button">Start Spotlight</button><script src="https://player.twitch.tv/js/embed/v1.js"></script><script>
window.spotlightSource={ready:false,activated:false,currentLogin:'',error:'',fps:0,bufferSize:0,playbackRate:0,skippedFrames:0,stalledForMs:0,recoveryCount:0,lastRecoveryReason:'',quality:''};
let player=null,currentLogin='',activated=false,switching=false,unhealthySince=0,lastRecoveryAt=0;
const endpoint=${JSON.stringify(endpoint)},button=document.getElementById('start');

function audio(){
 if(!player||!activated)return;
 try{player.setVolume(.58);player.setMuted(false);player.play()}catch{}
}

function chooseStableQuality(){
 if(!player)return;
 try{
  const qualities=typeof player.getQualities==='function'?player.getQualities():[];
  const values=(qualities||[]).map(value=>String(value||'')).filter(Boolean);
  const preferred=
    values.find(value=>/^720p30$/i.test(value))||
    values.find(value=>/^720p$/i.test(value))||
    values.find(value=>/^480p(?:30)?$/i.test(value))||
    values.find(value=>/^360p(?:30)?$/i.test(value))||
    values.find(value=>!/(?:60|chunked)/i.test(value))||
    'auto';
  if(preferred!=='auto'&&typeof player.setQuality==='function')player.setQuality(preferred);
  window.spotlightSource.quality=preferred;
 }catch{}
}

function playBootstrap(){
 if(!player)return;
 try{
  chooseStableQuality();
  player.setVolume(.58);
  player.setMuted(!activated);
  player.play();
 }catch{}
}

function resetHealth(){
 unhealthySince=0;
 window.spotlightSource.fps=0;
 window.spotlightSource.bufferSize=0;
 window.spotlightSource.playbackRate=0;
 window.spotlightSource.skippedFrames=0;
 window.spotlightSource.stalledForMs=0;
}

function bindPlayerEvents(nextPlayer){
 nextPlayer.addEventListener(Twitch.Player.READY,()=>{window.spotlightSource.ready=true;switching=false;resetHealth();chooseStableQuality();playBootstrap()});
 nextPlayer.addEventListener(Twitch.Player.PLAY,()=>{switching=false;unhealthySince=0;audio()});
 nextPlayer.addEventListener(Twitch.Player.PLAYING,()=>{switching=false;unhealthySince=0;chooseStableQuality();audio();setTimeout(audio,250);setTimeout(audio,1000)});
 nextPlayer.addEventListener(Twitch.Player.PAUSE,()=>{if(switching)setTimeout(playBootstrap,300)});
 nextPlayer.addEventListener(Twitch.Player.PLAYBACK_BLOCKED,()=>recover('playback-blocked'));
 nextPlayer.addEventListener(Twitch.Player.OFFLINE,()=>{currentLogin='';window.spotlightSource.currentLogin=''});
}

function createPlayer(login){
 const host=document.getElementById('player');
 host.replaceChildren();
 const target=document.createElement('div');
 target.id='spotlight-twitch-player';
 target.style.cssText='width:100%;height:100%;min-width:100%;min-height:100%';
 host.appendChild(target);
 player=new Twitch.Player('spotlight-twitch-player',{channel:login,parent:[location.hostname],autoplay:true,muted:true,controls:false,width:'100%',height:'100%'});
 bindPlayerEvents(player);
 return player;
}

function recover(reason){
 if(!player||!currentLogin||!activated)return;
 const now=Date.now();
 if(now-lastRecoveryAt<10000)return;
 lastRecoveryAt=now;
 window.spotlightSource.recoveryCount++;
 window.spotlightSource.lastRecoveryReason=reason;
 switching=true;
 const login=currentLogin;
 try{player.pause()}catch{}
 setTimeout(()=>{
  createPlayer(login);
  resetHealth();
  playBootstrap();
  audio();
  [500,1500,3000].forEach(ms=>setTimeout(()=>{playBootstrap();audio()},ms));
 },150);
}

function mount(login){
 const clean=String(login||'').replace(/^@/,'').trim().toLowerCase();
 if(!clean)return;
 if(clean===currentLogin&&player)return;
 currentLogin=clean;
 window.spotlightSource.currentLogin=clean;
 switching=true;
 resetHealth();
 if(player){
  try{player.setChannel(clean)}catch{createPlayer(clean)}
  playBootstrap();
  [350,1200,2500,4000].forEach(ms=>setTimeout(()=>{playBootstrap();audio()},ms));
  return;
 }
 createPlayer(clean);
}

function watchPlayback(){
 if(!player||!activated||!currentLogin)return;
 let paused=false,stats={};
 try{
  paused=Boolean(player.isPaused?.());
  stats=typeof player.getPlaybackStats==='function'?(player.getPlaybackStats()||{}):{};
 }catch{return}

 const now=Date.now();
 const fps=Number(stats.fps);
 const bufferSize=Number(stats.bufferSize);
 const playbackRate=Number(stats.playbackRate);
 const skippedFrames=Number(stats.skippedFrames);
 window.spotlightSource.fps=Number.isFinite(fps)?fps:0;
 window.spotlightSource.bufferSize=Number.isFinite(bufferSize)?bufferSize:0;
 window.spotlightSource.playbackRate=Number.isFinite(playbackRate)?playbackRate:0;
 window.spotlightSource.skippedFrames=Number.isFinite(skippedFrames)?skippedFrames:0;

 if(switching){
  unhealthySince=0;
  window.spotlightSource.stalledForMs=0;
  return;
 }

 if(paused){
  if(!unhealthySince)unhealthySince=now;
  window.spotlightSource.stalledForMs=now-unhealthySince;
  if(now-unhealthySince>=12000)recover('source-paused');
  return;
 }

 const fpsAvailable=Number.isFinite(fps)&&fps>0;
 const bitrateAvailable=Number.isFinite(playbackRate)&&playbackRate>0;
 const healthy=(fpsAvailable&&fps>=12)||(bitrateAvailable&&playbackRate>=100);
 if(healthy){
  unhealthySince=0;
  window.spotlightSource.stalledForMs=0;
  return;
 }

 if(!unhealthySince)unhealthySince=now;
 const stalledFor=now-unhealthySince;
 window.spotlightSource.stalledForMs=stalledFor;
 if(stalledFor>=12000)recover('live-playback-stalled');
}

button.addEventListener('click',()=>{activated=true;window.spotlightSource.activated=true;button.remove();resetHealth();playBootstrap();audio();[150,500,1000].forEach(ms=>setTimeout(audio,ms))});
async function refresh(){try{const r=await fetch(endpoint,{cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)throw Error('spotlight '+r.status);const data=await r.json(),login=data?.spotlight?.twitchLogin||data?.spotlight?.user?.twitchLogin||'';if(!login){window.spotlightSource.error='No live community Spotlight is available';return}window.spotlightSource.error='';mount(login)}catch(error){window.spotlightSource.error=String(error?.message||error)}}
refresh();setInterval(refresh,5000);setInterval(watchPlayback,2000);
</script></body></html>`;
}

module.exports = { createSpotlightBroadcast };
