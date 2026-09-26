export function renderLoungePlayer() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SpaceMountain Lounge live view</title><style>html,body,video{margin:0;width:100%;height:100%;overflow:hidden;background:#000}video{display:block;object-fit:contain}</style></head><body><video id="player" autoplay playsinline></video><script>
const video=document.getElementById('player');
video.volume=.85;video.muted=false;
// This is the OBS browser source. Twitch viewers adjust their own local
// volume; the one broadcast mix is applied here before OBS sends it out.
const mixOutput='media';
async function refreshBroadcastMix(){
 try{
  const response=await fetch('https://streamweaver-new.fly.dev/api/lounge/audio-mix',{cache:'no-store'});
  if(!response.ok)return;
  const mix=await response.json(),level=Number(mix?.levels?.[mixOutput]);
  if(Number.isInteger(level)&&level>=1&&level<=100)video.volume=level/100;
 }catch{}
}
refreshBroadcastMix();setInterval(refreshBroadcastMix,3000);
const codec='video/mp4; codecs="avc1.42E01F, mp4a.40.2"';
let controller,objectUrl='',retryTimer=0,generation=0,lastFrame=Date.now();
function retry(){if(!retryTimer)retryTimer=setTimeout(()=>{retryTimer=0;connect()},2000)}
async function connect(){
 clearTimeout(retryTimer);retryTimer=0;const id=++generation;
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
document.addEventListener('pointerdown',()=>video.play().catch(()=>{}));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)video.play().catch(()=>{})});
setInterval(()=>{if(Date.now()-lastFrame>15000)retry()},5000);
connect();
</script></body></html>`;
}
