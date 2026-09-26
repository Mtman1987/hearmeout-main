export function renderSpotlightPlayer() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SpaceMountain community Spotlight</title><style>html,body,video{margin:0;width:100%;height:100%;overflow:hidden;background:#000}video{display:block;object-fit:contain}</style></head><body><video id="player" autoplay playsinline muted></video><script>
const video=document.getElementById('player');
video.volume=.58;
const codec='video/mp4; codecs="avc1.42E01F, mp4a.40.2"';
let controller,objectUrl='',retryTimer=0,generation=0,lastPacket=0,lastProgress=0,lastTime=-1;
window.spotlightViewer={state:'connecting',playing:false,lastPacketAt:0,lastProgressAt:0,error:''};
function state(name,error=''){window.spotlightViewer.state=name;window.spotlightViewer.error=error}
function retry(reason='retry'){state('recovering',reason);if(!retryTimer)retryTimer=setTimeout(()=>{retryTimer=0;connect()},1500)}
async function connect(){
 clearTimeout(retryTimer);retryTimer=0;const id=++generation;
 controller?.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);
 video.removeAttribute('src');video.load();state('connecting');
 if(!window.MediaSource||!MediaSource.isTypeSupported(codec)){state('failed','MediaSource codec unsupported');return}
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
   video.play().catch(()=>{video.muted=true;video.play().catch(()=>{})});
  }
  buffer.addEventListener('updateend',pump);buffer.addEventListener('error',()=>retry('source-buffer-error'));
  const response=await fetch('/api/spotlight-media/live.mp4?viewer='+Date.now(),{cache:'no-store',signal:controller.signal});
  if(!response.ok||!response.body)throw Error('Spotlight source unavailable '+response.status);
  const reader=response.body.getReader();lastPacket=Date.now();window.spotlightViewer.lastPacketAt=lastPacket;state('buffering');
  while(id===generation){
   const result=await reader.read();if(result.done)break;
   const bytes=result.value,combined=new Uint8Array(pending.length+bytes.length);combined.set(pending);combined.set(bytes,pending.length);pending=combined;
   while(pending.length>=4){
    const size=new DataView(pending.buffer,pending.byteOffset,4).getUint32(0);
    if(size<8||size>16*1024*1024)throw Error('Invalid Spotlight frame');
    if(pending.length<size+4)break;
    const segment=pending.slice(4,size+4);pending=pending.slice(size+4);
    queue.push(segment);queuedBytes+=segment.byteLength;lastPacket=Date.now();window.spotlightViewer.lastPacketAt=lastPacket;
    if(queuedBytes>8*1024*1024)throw Error('Spotlight viewer fell behind');
    pump();
   }
  }
  if(id===generation)retry('stream-ended');
 }catch(error){if(id===generation&&!controller.signal.aborted)retry(error instanceof Error?error.message:String(error))}
}
video.addEventListener('playing',()=>{window.spotlightViewer.playing=true;lastProgress=Date.now();window.spotlightViewer.lastProgressAt=lastProgress;state('playing')});
video.addEventListener('pause',()=>{window.spotlightViewer.playing=false});
video.addEventListener('error',()=>retry('video-error'));
video.addEventListener('ended',()=>retry('video-ended'));
video.addEventListener('canplay',()=>video.play().catch(()=>{video.muted=true;video.play().catch(()=>{})}));
document.addEventListener('pointerdown',()=>{video.muted=false;video.play().catch(()=>{video.muted=true;video.play().catch(()=>{})})});
setInterval(()=>{
 const now=Date.now(),time=Number(video.currentTime||0);
 if(!video.paused&&time>lastTime+.05){lastTime=time;lastProgress=now;window.spotlightViewer.lastProgressAt=now;window.spotlightViewer.playing=true;state('playing')}
 if(lastPacket&&now-lastPacket>15000)retry('no-media-packets');
 else if(window.spotlightViewer.playing&&lastProgress&&now-lastProgress>12000)retry('playback-not-advancing');
},2000);
connect();
</script></body></html>`;
}

export function renderSpotlightControl() {
  return renderSpotlightPlayer();
}
