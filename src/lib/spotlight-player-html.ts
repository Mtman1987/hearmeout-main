export function renderSpotlightPlayer() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SpaceMountain Spotlight</title><style>
html,body,#player{margin:0;width:100%;height:100%;overflow:hidden;background:#000}#player,#player>div,#player iframe{width:100%;height:100%;border:0}.start{position:fixed;z-index:5;left:50%;top:50%;transform:translate(-50%,-50%);padding:16px 24px;border:0;border-radius:12px;background:#69e8ff;color:#031120;font:800 18px system-ui;cursor:pointer;box-shadow:0 8px 36px #0009}.start[hidden]{display:none}.message{position:fixed;z-index:6;left:50%;bottom:5%;transform:translateX(-50%);max-width:80%;padding:8px 12px;border-radius:8px;background:#000b;color:#e6f7ff;font:600 14px system-ui;text-align:center}
</style></head><body><div id="player"></div><button id="start" class="start" type="button">Start Spotlight</button><div id="message" class="message">Finding the current community Spotlight…</div><script>
const root=document.getElementById('player'),start=document.getElementById('start'),message=document.getElementById('message');
let player=null,currentLogin='',ready=false,activated=false;
function say(text){message.textContent=text}
function loadTwitch(){return new Promise((resolve,reject)=>{if(window.Twitch?.Player)return resolve();const script=document.createElement('script');script.src='https://player.twitch.tv/js/embed/v1.js';script.onload=resolve;script.onerror=()=>reject(Error('Could not load Twitch player'));document.head.append(script)})}
async function current(){const response=await fetch('/api/spotlight-media/current',{cache:'no-store'});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'No live community Spotlight is available');return data.login}
async function mount(login){if(player){if(login!==currentLogin){currentLogin=login;say('Switching to @'+login+'…');player.setChannel(login);if(activated)player.play().catch(()=>{})}return}currentLogin=login;ready=false;root.replaceChildren();await loadTwitch();const target=document.createElement('div');target.id='twitch-player';root.append(target);player=new Twitch.Player(target.id,{channel:login,parent:Array.from(new Set([location.hostname,'spmt.live'])),autoplay:false,muted:false,controls:false,width:'100%',height:'100%'});player.addEventListener(Twitch.Player.READY,()=>{ready=true;say('@'+currentLogin+' is ready. Click Start Spotlight.');if(activated)play()});player.addEventListener(Twitch.Player.ONLINE,()=>{if(activated){player.setMuted(false);player.play().catch(()=>{})}});player.addEventListener(Twitch.Player.OFFLINE,()=>say('@'+currentLogin+' is no longer live. Waiting for the next Spotlight.'))}
function play(){if(!player||!ready)return;say('Playing @'+currentLogin);start.hidden=true;player.setMuted(false);player.play().catch(()=>{start.hidden=false;say('Click Start Spotlight to play.')})}
async function refresh(){try{const login=await current();await mount(login);if(!activated)say('@'+login+' is ready. Click Start Spotlight.')}catch(error){currentLogin='';ready=false;root.replaceChildren();start.hidden=false;say(error.message||'No live community Spotlight is available')}}
start.addEventListener('click',()=>{activated=true;if(ready)play();else{say('Preparing the Spotlight…');refresh()}});
refresh();setInterval(refresh,30000);
</script></body></html>`;
}

export function renderSpotlightControl() {
  return renderSpotlightPlayer();
}
