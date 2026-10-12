const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);
const pending = new Map();
const audioCache = new Map();

function playlistUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(url.hostname)
      || !/^[A-Za-z0-9_-]{10,100}$/.test(url.searchParams.get('list') || '')) throw Error('Provide a public YouTube playlist URL');
  return 'https://www.youtube.com/playlist?list=' + url.searchParams.get('list');
}
async function readPlaylist(value, cookieArgs = []) {
  const url = playlistUrl(value);
  const { stdout } = await run('yt-dlp', ['--flat-playlist','--playlist-end','1000','--skip-download','--dump-single-json','--no-warnings',...cookieArgs,url], { timeout:60000,maxBuffer:16*1024*1024 });
  const data = JSON.parse(stdout);
  const entries=(data.entries || []).filter(entry=>/^[A-Za-z0-9_-]{11}$/.test(entry.id || '')).map(entry=>({
    id:entry.id,title:entry.title || 'Playlist song',duration:Number(entry.duration || 0)*1000,
    artist:entry.uploader || entry.channel || '',thumbnail:entry.thumbnails?.at(-1)?.url || '',
  }));
  if (!entries.length) throw Error('No public playlist videos found');
  return { title:data.title || 'Backup music', entries };
}
function opusFormat(format) {
  const mime=String(format.mime_type || format.mimeType || '');
  return mime.startsWith('audio/webm') && /opus/i.test(mime);
}
async function extractDiscordAudio(videoId, refresh = false) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw Error('Invalid YouTube video id');
  if (refresh) audioCache.delete(videoId);
  const cached=audioCache.get(videoId);
  if (cached && cached.expires>Date.now()) return cached.value;
  if (pending.has(videoId)) return pending.get(videoId);
  const job=(async()=>{
    const { Innertube, ClientType }=await import('youtubei.js');
    for (const client of ['ANDROID_VR','ANDROID','WEB','MWEB']) {
      try {
        const yt=await Innertube.create({client_type:ClientType?.[client] || client});
        const info=await yt.getBasicInfo(videoId);
        const formats=(info.streaming_data?.adaptive_formats || []).filter(opusFormat).sort((a,b)=>(Number(b.bitrate)||0)-(Number(a.bitrate)||0));
        for(const format of formats) {
          const url=format.url || (typeof format.decipher==='function' ? await format.decipher(yt.session.player).catch(()=>null):null);
          if (!url) continue;
          const response=await fetch(url,{headers:{range:'bytes=0-31'},signal:AbortSignal.timeout(10000)});
          await response.body?.cancel();
          if(!response.ok) continue;
          const value={url,mimeType:'audio/webm; codecs="opus"'};
          audioCache.set(videoId,{expires:Date.now()+30*60*1000,value});
          return value;
        }
      } catch {}
    }
    throw Error('Discord-compatible Opus source unavailable. Try another song.');
  })();
  pending.set(videoId,job);
  try { return await job; } finally { pending.delete(videoId); }
}
module.exports={playlistUrl,readPlaylist,opusFormat,extractDiscordAudio};
