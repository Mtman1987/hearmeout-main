const test=require('node:test'), assert=require('node:assert/strict');
const {playlistUrl,opusFormat}=require('../src/youtube-request-media');
test('playlist reader is restricted to YouTube playlist references',()=>{
 assert.equal(playlistUrl('https://youtube.com/playlist?list=PLaMvYvPWs3CtzNHDHFks9hpMQxXCBc8zR'),'https://www.youtube.com/playlist?list=PLaMvYvPWs3CtzNHDHFks9hpMQxXCBc8zR');
 assert.throws(()=>playlistUrl('https://example.com/playlist?list=PL1234567890'));
 assert.throws(()=>playlistUrl('http://youtube.com/playlist?list=PL1234567890'));
});
test('Discord fallback selects audio WebM Opus and rejects AAC or video-only formats',()=>{
 assert(opusFormat({mime_type:'audio/webm; codecs="opus"'}));
 assert(!opusFormat({mime_type:'audio/mp4; codecs="mp4a.40.2"'}));
 assert(!opusFormat({mime_type:'video/webm; codecs="vp9"'}));
 assert(!opusFormat({mime_type:'audio/webm; codecs="vorbis"'}));
});
