const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { streamDiscordAudio, CHUNK_SIZE } = require('../src/discord-audio-stream');
const data = Buffer.from(Array.from({ length: CHUNK_SIZE * 2 + 321 }, (_, i) => i % 251));
test('direct audio relays open, closed, suffix and full requests without converting', async () => {
  const ranges = [];
  let refreshes = 0;
  const upstream = async (url, options) => {
    ranges.push(options.headers.range);
    const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.range);
    assert.ok(match, 'only closed ranges reach upstream');
    const start = Number(match[1]), end = Math.min(Number(match[2]), data.length - 1);
    assert.ok(end - start + 1 <= CHUNK_SIZE);
    const bytes = data.subarray(start, end + 1);
    return new Response(bytes, {status: 206, headers: {'content-range': 'bytes '+start+'-'+end+'/'+data.length}});
  };
  const server = http.createServer((req,res) => {
    req.params = {videoId:'abcdefghijk'};
    res.status = code => {res.statusCode=code;return res;};
    res.json = value => res.end(JSON.stringify(value));
    streamDiscordAudio(req,res,async()=>{refreshes++;return {url:'https://source.test/audio'};},upstream);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    for (const range of [undefined, 'bytes=0-', 'bytes=123-', 'bytes=13-23', 'bytes=-200']) {
      const response = await fetch('http://127.0.0.1:'+server.address().port, {headers:range?{range}:{}});
      const expected = !range || range==='bytes=0-' ? data : range==='bytes=123-' ? data.subarray(123) : range==='bytes=-200' ? data.subarray(-200) : data.subarray(13,24);
      assert.equal(response.status, range?206:200);
      assert.equal(Number(response.headers.get('content-length')),expected.length);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
    }
    for (const range of ['bytes=23-13','bytes=0-1,4-5','bytes=-0']) {
      const response=await fetch('http://127.0.0.1:'+server.address().port,{headers:{range}});
      assert.equal(response.status,416);
    }
    assert.ok(ranges.length>5);assert.equal(refreshes,8);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
