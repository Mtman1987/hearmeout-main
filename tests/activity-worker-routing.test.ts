import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
function compile(path: string, globals: any) {
  const exports:any={};
  const content=readFileSync(path,'utf8');
  const compiled=ts.transpileModule(content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(compiled,{exports,URL,URLSearchParams,Response,Headers,Request,...globals});
  return exports;
}
const config=compile('src/lib/dj-worker-config.ts',{process:{env:{NODE_ENV:'production'}}});
test('Activity rendition routing includes both audio and video and ignores the old DJ pin',async()=>{
  const manifest='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="stream_eng.m3u8?machine=old"\n#EXT-X-STREAM-INF:AUDIO="audio"\nstream_video.m3u8?machine=old\n';
  const tagged=config.activityMediaManifest(manifest);
  assert.match(tagged,/URI="stream_eng.m3u8\?machine=old&lane=activity"/);
  assert.match(tagged,/stream_video.m3u8\?machine=old&lane=activity/);
  for(const path of ['src/app/api/watch/xtream/hls/[streamId]/[file]/route.ts','src/app/api/watch/youtube/hls/[videoId]/[file]/route.ts']){
    const calls:any[]=[];
    const route=compile(path,{fetch:async(url:URL,options:any)=>{calls.push({url:String(url),headers:options.headers});return new Response(manifest,{headers:{'content-type':'application/vnd.apple.mpegurl','content-length':String(manifest.length)}});},require(name:string){
      if(name==='next/server')return {NextResponse:Response};
      if(name==='node:stream')return {};
      if(name==='@/lib/dj-worker-config')return config;
      if(name==='@/lib/dj-worker-auth')return {getDjWorkerRequestHeaders:(value:any)=>new Headers(value)};
      if(name==='@/lib/validate-video-id')return {isValidVideoId:()=>true};
      if(name==='@/app/api/watch/youtube/resolve/route')return {getResolvedYoutubeUrls:()=>null};
      if(name==='@/lib/watch/xtream-provider')return {getResolvedXtreamStreamUrl:async()=>new URL('https://fixture.test/movie')};
      if(name==='@/lib/watch/xtream-hls')return {};
      throw new Error(name);
    }});
    const request=new Request('https://hmo.test/api/media?lane=activity&machine=old');
    const response=await route.GET(request,{params:Promise.resolve({streamId:'vod-123',videoId:'abcdefghijk',file:'index.m3u8'})});
    assert.equal(response.status,200);
    assert.match(calls[0].url,/hmo-dj-worker.fly.dev:4446/);
    assert.equal(new URL(calls[0].url).searchParams.has('machine'),false);
    assert.equal(calls[0].headers.has('fly-force-instance-id'),false);
    assert.match(await response.text(),/lane=activity/);
    assert.equal(response.headers.has('content-length'),false);
  }
  assert.equal(config.getMediaWorkerUrl(new Request('https://hmo.test/api/media')),'https://hmo-dj-worker.fly.dev');
});
