export function renderLoungePlayer() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SpaceMountain Lounge live view</title><style>html,body,video{margin:0;width:100%;height:100%;overflow:hidden;background:#000}video{display:block;object-fit:contain}</style></head><body><video id="player" autoplay playsinline></video><audio id="theme" preload="auto"></audio><script>
const video=document.getElementById('player');
const theme=document.getElementById('theme');
const themeTracks=[
 '/api/offline-music?id=c3BhY2Vtb3VudGFpbmxpdmUvc3BtdC5tcDM',
 '/api/offline-music?id=c3BhY2Vtb3VudGFpbmxpdmUvc3BtdDIubXAz',
 '/api/offline-music?id=c3BhY2Vtb3VudGFpbmxpdmUvc3BtdDMubXAz',
 '/api/offline-music?id=c3BhY2Vtb3VudGFpbmxpdmUvc3BtdDQubXAz'
];
let themeIndex=0,themeFailures=0,themeActive=false;
theme.src=themeTracks[0];
function playTheme(){if(themeActive)theme.play().catch(error=>console.warn('[Lounge] Theme autoplay unavailable:',error))}
function advanceTheme(failed){
 if(!themeActive)return;
 themeFailures=failed?themeFailures+1:0;
 if(themeFailures>=themeTracks.length){themeActive=false;theme.pause();return}
 themeIndex=(themeIndex+1)%themeTracks.length;
 theme.src=themeTracks[themeIndex];
 playTheme();
}
theme.addEventListener('ended',()=>advanceTheme(false));
theme.addEventListener('error',()=>advanceTheme(true));
theme.addEventListener('playing',()=>{themeFailures=0});
function setThemeActive(active){
 if(themeActive===active)return;
 themeActive=active;
 if(active){themeFailures=0;playTheme()}else theme.pause();
}
video.volume=.85;video.muted=false;
let groupLevel=.85,masterLevel=1,sourceVolume=1,sourceMuted=false,brbActive=false;
function applyBroadcastVolume(){
 const volume=groupLevel*masterLevel*sourceVolume;
 video.volume=volume;video.muted=sourceMuted||brbActive;
 theme.volume=volume;theme.muted=sourceMuted;
}
window.addEventListener('message',(event)=>{
 if(event.source!==window.parent||event.origin!=='https://spmt.live'||event.data?.type!=='spmt.obspmt.audio')return;
 const level=Number(event.data.volume);
 if(!Number.isFinite(level)||level<0||level>1||typeof event.data.muted!=='boolean')return;
 sourceVolume=level;sourceMuted=event.data.muted;applyBroadcastVolume();
});
window.addEventListener('message',(event)=>{
 if(event.source!==window.parent||event.origin!=='https://spmt.live'
  ||event.data?.type!=='spmt-lounge-brb-audio'||typeof event.data.active!=='boolean')return;
 brbActive=event.data.active;
 setThemeActive(brbActive&&event.data.mode==='gif');
 applyBroadcastVolume();
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
function retry(){if(!retryTimer)retryTimer=setTimeout(()=>{retryTimer=0;connect()},2000)}
async function connect(){
 clearTimeout(retryTimer);retryTimer=0;const id=++generation;lastProgress=Date.now();lastTime=0;
 controller?.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);
 video.removeAttribute('src');video.load();
 if(!window.MediaSource||!MediaSource.isTypeSupported(codec))return;
 controller=new AbortController();const source=new MediaSource();objectUrl=URL.createObjectURL(source);video.src=objectUrl;
 try{
  await new Promise((resolve,reject)=>{source.addEventListener('sourceopen',resolve,{once:true});source.addEventListener('error',reject,{once:true})});
  if(id!==generation)return;
  const buffer=source.addSourceBuffer(codec);buffer.mode='sequence';
  const queue=[];let queuedBytes=0,pending=new Uint8Array(0);
  function pump(){
   if(id!==generation||buffer.updating||source.readyState!=='open')return;
   if(video.currentTime>30&&buffer.buffered.length&&buffer.buffered.start(0)<video.currentTime-20){buffer.remove(0,video.currentTime-15);return}
   if(!queue.length)return;
   const segment=queue.shift();queuedBytes-=segment.byteLength;buffer.appendBuffer(segment);
   video.play().catch(()=>{});
  }
  buffer.addEventListener('updateend',pump);buffer.addEventListener('error',retry);
  const response=await fetch('/api/lounge-media/live.mp4?viewer='+Date.now(),{cache:'no-store',signal:controller.signal});
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
video.addEventListener('canplay',()=>video.play().catch(()=>{}));
video.addEventListener('timeupdate',()=>{if(video.currentTime>lastTime+.1){lastTime=video.currentTime;lastProgress=Date.now()}});
document.addEventListener('pointerdown',()=>video.play().catch(()=>{}));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)video.play().catch(()=>{})});
setInterval(()=>{
 const now=Date.now();
 if(now-lastFrame>15000){retry();return}
 // The transport may keep receiving fragments while the decoder is stuck
 // on one frame. Rejoin the live source when playback itself stops moving.
 if(!video.paused&&now-lastProgress>20000)retry();
},5000);
connect();
</script></body></html>`;
}
