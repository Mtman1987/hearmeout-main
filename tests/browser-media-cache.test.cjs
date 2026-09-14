const assert=require('node:assert/strict');
const test=require('node:test');
const {mkdtempSync,rmSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {createBrowserMediaCache}=require('../worker/src/browser-media-cache');
test('browser uploads retain both tracks as local bytes and recognize existing cached audio',()=>{
 const root=mkdtempSync(join(tmpdir(),'hmo-browser-cache-'));
 try{
  const cache=createBrowserMediaCache(root,id=>id==='existing123'?'/existing/audio.m4a':null);
  assert.deepEqual(cache.status('abcdefghijk'),{audio:false,video:false});
  cache.write('abcdefghijk','video',Buffer.from('video bytes'));
  assert.deepEqual(cache.status('abcdefghijk'),{audio:false,video:true});
  cache.write('abcdefghijk','audio',Buffer.from('audio bytes'));
  assert.equal(readFileSync(cache.file('abcdefghijk','audio'),'utf8'),'audio bytes');
  assert.equal(readFileSync(cache.file('abcdefghijk','video'),'utf8'),'video bytes');
  assert.deepEqual(cache.status('existing123'),{audio:true,video:false});
  assert.throws(()=>cache.write('../escape','audio',Buffer.from('x')),/Invalid/);
  assert.throws(()=>cache.write('abcdefghijk','video',Buffer.alloc(0)),/Invalid/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
