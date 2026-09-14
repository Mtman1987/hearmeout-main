// Direct IPTV test: no Apollo, HearMeOut API, Sprite, or sandbox proxy.
// node --env-file=/path/to/iptv.env scripts/search-iptv-direct.mjs "Batman"
// Config: XTREAM_BASE_URL, XTREAM_USERNAME, XTREAM_PASSWORD.
// An existing XTREAM_PLAYLIST_URL/IPTV_PLAYLIST_URL containing username and
// password may supply the same connection details.
const query=(process.argv[2]||'Batman').trim();
const playlist=process.env.XTREAM_PLAYLIST_URL||process.env.IPTV_PLAYLIST_URL||process.env.M3U_PLAYLIST_URL;
let connection;
try { connection=playlist?new URL(playlist):undefined; } catch {}
const base=process.env.XTREAM_BASE_URL||connection?.origin;
const username=process.env.XTREAM_USERNAME||connection?.searchParams.get('username');
const password=process.env.XTREAM_PASSWORD||connection?.searchParams.get('password');
if(!base||!username||!password){
  console.error(JSON.stringify({tested:false,error:'Missing IPTV provider URL, username, or password. Supply the existing connection through an environment file.'}));
  process.exit(1);
}
const started=Date.now();
try{
  const url=new URL('/player_api.php',base);
  if(!['http:','https:'].includes(url.protocol))throw Error('Unsupported provider protocol');
  url.searchParams.set('username',username);
  url.searchParams.set('password',password);
  url.searchParams.set('action','get_vod_streams');
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(60000)});
  if(!response.ok){console.log(JSON.stringify({tested:true,httpStatus:response.status,elapsedMs:Date.now()-started,error:'Direct IPTV provider request failed'}));process.exitCode=1;}
  else{
    const body=await response.json();
    if(!Array.isArray(body))throw Error('Provider returned an account/error object instead of a VOD catalog');
    const needle=query.toLowerCase();
    const matching=body.filter(item=>String(item.name||'').toLowerCase().includes(needle));
    matching.sort((a,b)=>Number(String(b.name).toLowerCase()===needle)-Number(String(a.name).toLowerCase()===needle)||String(a.name).localeCompare(String(b.name)));
    console.log(JSON.stringify({tested:true,query,httpStatus:response.status,elapsedMs:Date.now()-started,catalogCount:body.length,matchingCount:matching.length,shown:Math.min(24,matching.length),matches:matching.slice(0,24).map(item=>({id:item.stream_id,title:item.name,year:item.year??null,container:item.container_extension??null}))},null,2));
  }
}catch(error){
  // Never print a request URL, provider response body, or credential values.
  console.error(JSON.stringify({tested:true,elapsedMs:Date.now()-started,error:error.name==='TimeoutError'?'Direct provider request timed out':error instanceof SyntaxError?'Provider response was not JSON':'Direct provider request could not retrieve a VOD catalog',networkCode:error.cause?.code??null}));
  process.exitCode=1;
}
