export function renderLoungePlayer() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SpaceMountain Lounge live view</title><style>html,body,video{margin:0;width:100%;height:100%;overflow:hidden;background:#000}video{display:block;object-fit:contain}#preparing{position:absolute;inset:0;z-index:2;display:none;box-sizing:border-box;align-items:center;justify-content:center;padding:5%;color:#fff;background:radial-gradient(circle at center,#20153d 0%,#090919 65%,#000 100%);font:600 clamp(18px,3vw,32px)/1.35 system-ui,sans-serif;text-align:center}#preparing .card{width:min(84%,650px);padding:clamp(24px,5vw,52px);border:2px solid #55d7ed;border-radius:24px;box-shadow:0 0 32px #339fd080;background:#0d1739}#preparing .eyebrow{color:#77ddf0;font-size:clamp(14px,1.6vw,20px);letter-spacing:.12em;text-transform:uppercase}#preparing .title{margin:18px 0 10px;overflow-wrap:anywhere}#preparing .requester{color:#d7c5ff;font-size:clamp(15px,2vw,22px);font-weight:400}#preparing .detail{margin-top:20px;color:#c1c8d4;font-size:clamp(14px,1.5vw,18px);font-weight:400}#preparing.empty .card{width:min(92%,650px);padding:clamp(12px,3vw,32px);border-radius:16px}#preparing.empty .title{margin:10px 0;font-size:clamp(18px,3vw,30px)}#preparing.empty .detail{margin-top:10px}</style></head><body><video id="player" autoplay playsinline></video><div id="preparing" role="status" aria-live="polite"><div class="card"><div id="preparing-kind" class="eyebrow">Preparing your media</div><div id="preparing-title" class="title"></div><div id="preparing-requester" class="requester"></div><div id="preparing-detail" class="detail">Your selection is loading</div></div></div><iframe id="direct-player" title="Lounge media" allow="autoplay" style="display:none;border:0;width:100%;height:100%"></iframe><script>
// Parent recovery tracks page load separately from media buffering.
function announcePlayerLoaded(){window.parent.postMessage({type:'spmt-lounge-media-ready'},'https://spmt.live')}
announcePlayerLoaded();setInterval(announcePlayerLoaded,5000);
const video=document.getElementById('player');
const directPlayer=document.getElementById('direct-player');
const directMode=new URLSearchParams(location.search).get('direct')==='1';
if(directMode){video.style.display='none';directPlayer.style.display='block';directPlayer.src='/overlay/system-spacemountainlive-lounge?clean=1&direct=1&volume=0.85&muted=0';directPlayer.addEventListener('load',()=>applyBroadcastVolume())}
video.volume=.85;video.muted=false;
let groupLevel=.85,masterLevel=1,sourceVolume=1,sourceMuted=false;
function applyBroadcastVolume(){
 const volume=groupLevel*masterLevel*sourceVolume;
 video.volume=volume;video.muted=sourceMuted;
 if(directMode)directPlayer.contentWindow?.postMessage({type:'hmo.lounge.broadcast-volume',volume,muted:sourceMuted},location.origin);
}
window.addEventListener('message',(event)=>{
 if(event.source!==window.parent||event.origin!=='https://spmt.live'||event.data?.type!=='spmt.obspmt.audio')return;
 const level=Number(event.data.volume);
 if(!Number.isFinite(level)||level<0||level>1||typeof event.data.muted!=='boolean')return;
 sourceVolume=level;sourceMuted=event.data.muted;applyBroadcastVolume();
});
// This is the OBS browser source. Twitch viewers adjust their own local
// volume; the one broadcast mix is applied here before OBS sends it out.
const mixOutput='media';
async function refreshBroadcastMix(){
 try{
  const response=await fetch('https://streamweaver-new.fly.dev/api/lounge/audio-mix',{cache:'no-store'});
  if(!response.ok)return;
  const mix=await response.json(),level=Number(mix?.levels?.[mixOutput]);
  const all=mix?.levels?.all===undefined?100:Number(mix.levels.all);
  if(Number.isInteger(level)&&level>=0&&level<=100&&Number.isInteger(all)&&all>=0&&all<=100){
   groupLevel=level/100;masterLevel=all/100;applyBroadcastVolume();
  }
 }catch{}
}
refreshBroadcastMix();setInterval(refreshBroadcastMix,3000);
const codec='video/mp4; codecs="avc1.42E01F, mp4a.40.2"';
let controller,objectUrl='',retryTimer=0,generation=0,lastFrame=Date.now(),lastProgress=Date.now(),lastTime=0;
// MP4 fragments arrive every ~2 seconds. Leave enough decoded media ahead of
// playback to absorb a slow fragment without pausing the broadcast.
const playbackCushion=8;
let rebuffering=true,resumePlayback=()=>{};
function bufferedAhead(){
 const ranges=video.buffered;
 for(let i=0;i<ranges.length;i++){
  if(ranges.start(i)<=video.currentTime+.1&&ranges.end(i)>video.currentTime)
   return ranges.end(i)-video.currentTime;
 }
 return 0;
}
function retry(){if(directMode)return;if(!retryTimer)retryTimer=setTimeout(()=>{retryTimer=0;connect()},2000)}
async function connect(){
 clearTimeout(retryTimer);retryTimer=0;const id=++generation;lastProgress=Date.now();lastTime=0;
 rebuffering=true;resumePlayback=()=>{};
 controller?.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);
 video.removeAttribute('src');video.load();
 if(!window.MediaSource||!MediaSource.isTypeSupported(codec))return;
 controller=new AbortController();const source=new MediaSource();objectUrl=URL.createObjectURL(source);video.src=objectUrl;
 try{
  await new Promise((resolve,reject)=>{source.addEventListener('sourceopen',resolve,{once:true});source.addEventListener('error',reject,{once:true})});
  if(id!==generation)return;
  const buffer=source.addSourceBuffer(codec);buffer.mode='sequence';
  const queue=[];let queuedBytes=0,pending=new Uint8Array(0);
  resumePlayback=()=>{
   if(id!==generation||bufferedAhead()<playbackCushion)return;
   if(rebuffering||video.paused){
    rebuffering=false;
    video.play().catch(()=>{rebuffering=true});
   }
  };
  function pump(){
   if(id!==generation||buffer.updating||source.readyState!=='open')return;
   if(video.currentTime>30&&buffer.buffered.length&&buffer.buffered.start(0)<video.currentTime-20){buffer.remove(0,video.currentTime-15);return}
   if(!queue.length)return;
   const segment=queue.shift();queuedBytes-=segment.byteLength;buffer.appendBuffer(segment);
  }
  buffer.addEventListener('updateend',()=>{pump();resumePlayback()});buffer.addEventListener('error',retry);
  const response=await fetch('https://hmo-dj-worker.fly.dev:4444/lounge/live.mp4?viewer='+Date.now(),{cache:'no-store',signal:controller.signal});
  if(!response.ok||!response.body)throw Error('Lounge source unavailable');
  const reader=response.body.getReader();lastFrame=Date.now();
  while(id===generation){
   const result=await reader.read();if(result.done)break;
   const bytes=result.value,combined=new Uint8Array(pending.length+bytes.length);combined.set(pending);combined.set(bytes,pending.length);pending=combined;
   while(pending.length>=4){
    const size=new DataView(pending.buffer,pending.byteOffset,4).getUint32(0);
    if(size<8||size>16*1024*1024)throw Error('Invalid Lounge frame');
    if(pending.length<size+4)break;
    const segment=pending.slice(4,size+4);pending=pending.slice(size+4);
    queue.push(segment);queuedBytes+=segment.byteLength;lastFrame=Date.now();
    if(queuedBytes>8*1024*1024)throw Error('Lounge viewer fell behind');
    pump();
   }
  }
  if(id===generation)retry();
 }catch(error){if(id===generation&&!controller.signal.aborted)retry()}
}
video.addEventListener('error',retry);video.addEventListener('ended',retry);
video.addEventListener('canplay',()=>resumePlayback());
video.addEventListener('waiting',()=>{
 if(directMode||video.paused||bufferedAhead()>=2)return;
 rebuffering=true;video.pause();
});
video.addEventListener('timeupdate',()=>{if(video.currentTime>lastTime+.1){lastTime=video.currentTime;lastProgress=Date.now()}});
document.addEventListener('pointerdown',()=>resumePlayback());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)resumePlayback()});
setInterval(()=>{
 if(directMode)return;
 const now=Date.now();
 if(now-lastFrame>15000){retry();return}
 // The transport may keep receiving fragments while the decoder is stuck
 // on one frame. Rejoin the live source when playback itself stops moving.
 if(lastTime>0&&now-lastProgress>20000)retry();
},5000);
let selectedProgram=null,selectedLane='',selectedAt=0,programRefreshBusy=false;
const preparing=document.getElementById('preparing');
const preparingKind=document.getElementById('preparing-kind');
const preparingTitle=document.getElementById('preparing-title');
const preparingRequester=document.getElementById('preparing-requester');
const preparingDetail=document.getElementById('preparing-detail');
function setPreparing(visible){
 preparing.style.display=visible?'flex':'none';
}
function showRequestPrompt(){
 preparing.classList.add('empty');
 preparingKind.textContent='Requests welcome';
 preparingTitle.textContent='What should we play next?';
 preparingRequester.textContent='Request a song: !sr <song or artist>';
 preparingDetail.textContent='Request something to watch: !wr <title or link>';
 setPreparing(true);
}
function currentProgram(data){
 const lanes=['movie','music'].map(lane=>({lane,state:data?.[lane]}))
  .filter(entry=>entry.state?.current&&entry.state.playback?.status==='playing')
  .sort((a,b)=>Number(b.state.playback.updatedAt||0)-Number(a.state.playback.updatedAt||0));
 return lanes[0]||null;
}
async function refreshProgram(){
 if(programRefreshBusy)return;
 programRefreshBusy=true;
 try{
  const response=await fetch('/api/lounge-media/program',{cache:'no-store'});
  if(!response.ok)throw Error('Program unavailable');
  const active=currentProgram(await response.json());
  const next=active?.state.current||null;
  const lane=active?.lane||'';
  if(next?.requestId!==selectedProgram?.requestId||lane!==selectedLane){
   selectedProgram=next;selectedLane=lane;selectedAt=Date.now();lastProgress=0;
   preparingKind.textContent='Preparing your '+(lane||'media');
   preparingTitle.textContent=next?.item?.title||'';
   preparingRequester.textContent=next?.requestedBy?.username?'Selected by '+next.requestedBy.username:'';
   if(next&&lane==='movie'){window.location.replace('/lounge-media/direct');return}
   if(next&&!directMode)connect();
  }
  if(!next){showRequestPrompt();return}
  preparing.classList.remove('empty');
  let ready=false;
  if(directMode){
   try{
    const root=directPlayer.contentDocument?.querySelector('[data-request-id]');
    ready=root?.dataset.requestId===next.requestId&&root?.dataset.mediaHealthy==='true';
   }catch{}
  }else{
   const statusResponse=await fetch('/api/lounge-media/status',{cache:'no-store'});
   if(statusResponse.ok){
    const status=await statusResponse.json();
    ready=status.mediaHealthy===true&&status.mediaTitle===next.item.title
      &&video.readyState>=2&&!video.paused&&Date.now()-lastProgress<5000
      &&lastProgress>=selectedAt+500;
   }
  }
  preparingDetail.textContent=Date.now()-selectedAt>30000
   ?'Still preparing. The player is reconnecting.':'Your selection is loading';
  setPreparing(!ready);
 }catch{
  if(selectedProgram){preparingDetail.textContent='Still preparing. The player is reconnecting.';setPreparing(true)}
 }finally{programRefreshBusy=false}
}
refreshProgram();setInterval(refreshProgram,2500);
if(!directMode)connect();
</script></body></html>`;
}
