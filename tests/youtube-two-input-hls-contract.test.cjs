const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../worker/src/server.js'), 'utf8');

test('YouTube HLS keeps separate yt-dlp video and audio inputs', () => {
  assert.match(source, /spawn\('yt-dlp', youtubeYtDlpStreamArgs\(videoId, 'video'/);
  assert.match(source, /spawn\('yt-dlp', youtubeYtDlpStreamArgs\(videoId, 'audio'/);
  assert.match(source, /'-i', 'pipe:3',[\s\S]*'-i', 'pipe:4'/);
  assert.match(source, /'-map', '0:v:0',[\s\S]*'-map', '1:a:0'/);
  assert.match(source, /video\.stdout\.pipe\(ffmpeg\.stdio\[3\]\)/);
  assert.match(source, /audio\.stdout\.pipe\(ffmpeg\.stdio\[4\]\)/);
});

test('normal worker HLS no longer hands extracted signed URLs back to FFmpeg', () => {
  const normalPath = source.slice(source.indexOf('function ensureYoutubeWatchHls'), source.indexOf('function getRecentWatchHlsFailure'));
  assert.match(normalPath, /runYoutubeHlsFromYtDlp/);
  assert.doesNotMatch(normalPath, /extractVideoInfo\(videoId\)/);
  assert.doesNotMatch(normalPath, /extractAudioInfo\(videoId\)/);
});
