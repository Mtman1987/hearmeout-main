export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><style>html,body,video,iframe{margin:0;width:100%;height:100%;overflow:hidden;background:#000}video{display:block;object-fit:contain}iframe{display:none;border:0}#start{position:fixed;top:45%;left:45%;z-index:2}</style></head><body><video id="media" playsinline></video><iframe id="fallback" allow="autoplay; fullscreen"></iframe><button id="start">Start Lounge</button><script src="/api/lounge-media/hls.js"></script><script>
const video=document.getElementById('media'),fallback=document.getElementById('fallback'),start=document.getElementById('start');
window.spotlightSource={ready:true,activated:false,currentLogin:'',error:''};
let lane='',requestId='',sessionId='',hls=null,busy=false,advancing=false,lastPlayback='';
function reset(){if(hls){hls.destroy();hls=null}video.pause();video.removeAttribute('src');video.load();fallback.src='about:blank';fallback.style.display='none';video.style.display='block'}
function position(playback){return Math.max(0,Number(playback?.position||0)+(playback?.status==='playing'?(Date.now()-Number(playback.updatedAt||Date.now()))/1000:0))}
async function advance(){if(advancing||!requestId||!sessionId)return;advancing=true;try{await fetch('/api/watch/sessions/'+encodeURIComponent(sessionId)+'/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'next',expectedRequestId:requestId})})}catch(e){window.spotlightSource.error=String(e)}finally{advancing=false}}
function fallbackEmbed(item){if(!item?.metadata?.embedPlaybackUrl)return;reset();video.style.display='none';fallback.style.display='block';const url=new URL(item.metadata.embedPlaybackUrl);url.searchParams.set('autoplay','1');url.searchParams.set('mute','0');url.searchParams.set('controls','0');fallback.src=url.toString()}
function load(item,playback){reset();const url=item.playbackUrl;if(!url)return;window.spotlightSource.error='';
 if(/\\.m3u8(?:$|\\?)/i.test(url)&&window.Hls?.isSupported()){
  hls=new Hls({lowLatencyMode:true,maxBufferLength:12});
  hls.on(Hls.Events.ERROR,(_event,data)=>{if(data?.fatal){window.spotlightSource.error='Media source: '+(data.details||data.type);fallbackEmbed(item)}});
  hls.on(Hls.Events.MANIFEST_PARSED,()=>{const p=position(playback);if(Number.isFinite(p)&&p>0)video.currentTime=p;video.play().catch(()=>{})});
  hls.loadSource(url);hls.attachMedia(video);
 }else{video.src=url;video.addEventListener('loadedmetadata',()=>{const p=position(playback);if(Number.isFinite(p)&&p>0)video.currentTime=Math.min(p,Number.isFinite(video.duration)?Math.max(0,video.duration-.1):p);video.play().catch(()=>{})},{once:true})}
}
async function refresh(){if(busy||!window.spotlightSource.activated)return;busy=true;try{
 const r=await fetch('/api/lounge-media/source-state',{cache:'no-store'});if(!r.ok)throw Error('state '+r.status);const data=await r.json();const current=data.session.current,playback=data.session.playback;
 if(data.lane!==lane||current?.requestId!==requestId){lane=data.lane;requestId=current?.requestId||'';sessionId=data.session.id;lastPlayback='';window.spotlightSource.currentLogin=current?.item?.title||'';if(current)load(current.item,playback);else reset()}
 if(current){const key=playback.status+':'+playback.updatedAt;if(key!==lastPlayback){lastPlayback=key;if(playback.status==='paused')video.pause();else video.play().catch(()=>{})}video.volume=Math.max(0,Math.min(1,Number(playback.volume??85)/100));video.muted=Boolean(playback.muted);
  const runtime=String(current.item.runtime||''),hours=Number(runtime.match(/(\\d+)\\s*h/)?.[1]||0),minutes=Number(runtime.match(/(\\d+)\\s*m/)?.[1]||0),seconds=Number(runtime.match(/(\\d+)\\s*s/)?.[1]||0),duration=hours*3600+minutes*60+seconds;
  if(duration&&position(playback)>duration+3)await advance();
 }
 window.spotlightSource.error='';
}catch(e){window.spotlightSource.error=String(e)}finally{busy=false}}
video.addEventListener('ended',()=>void advance());video.addEventListener('error',()=>{window.spotlightSource.error='Media playback failed'});
start.addEventListener('click',()=>{window.spotlightSource.activated=true;start.remove();void refresh()});setInterval(()=>void refresh(),2000);
</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
