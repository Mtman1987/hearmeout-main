import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
test('Activity streams original Opus without consulting cache or HLS', async () => {
 for (const type of ['missing','audio/mp4']) {
  const source=readFileSync('src/app/api/watch/sessions/[sessionId]/state/route.ts','utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:any={},calls:any[]=[];
  vm.runInNewContext(compiled,{exports,URL,URLSearchParams,Headers,Request,Response,AbortSignal,console,fetch:async(url:any,options:any)=>{
    calls.push({url:String(url),options});

    assert.equal(options.headers.get('range'),'bytes=0-3');
    return new Response(new Uint8Array([0x1a,0x45,0xdf,0xa3]),{status:206,headers:{'content-type':'audio/webm','content-range':'bytes 0-3/100','content-length':'4'}});
  },require:(name:string)=>{
    if(name==='next/server')return {NextResponse:Response};
    if(name==='@/lib/watch-request-service')return {};
    if(name==='@/lib/dj-worker-config')return {getMediaWorkerUrl:()=> 'https://worker.test:4446'};
    if(name==='@/lib/dj-worker-auth')return {getDjWorkerRequestHeaders:(headers:any)=>new Headers(headers)};
    if(name==='@/lib/validate-video-id')return {isValidVideoId:()=>true};
    if(name.includes('youtube/hls'))return {GET:async()=>{throw Error('Activity audio must bypass HLS and cache');}};
    throw Error(name);
  }});
  const response=await exports.GET(new Request('https://hmo.test/api/watch/sessions/discord-music-room/state?mediaVideoId=abcdefghijk&mediaFile=source.webm&lane=activity',{headers:{range:'bytes=0-3'}}),{params:Promise.resolve({sessionId:'discord-music-room'})});
  assert.equal(response.status,206);assert.equal(response.headers.get('content-type'),'audio/webm');
  assert.equal(response.headers.get('content-range'),'bytes 0-3/100');
  assert.equal(calls.length,1);assert.match(calls[0].url,/worker.test:4446\/watch\/youtube\/discord-audio\/abcdefghijk\/stream/);
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())),[0x1a,0x45,0xdf,0xa3]);
 }
});
