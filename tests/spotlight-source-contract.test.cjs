const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const source = readFileSync(resolve(__dirname, '../worker/src/spotlight-hls.js'), 'utf8');
const server = readFileSync(resolve(__dirname, '../worker/src/server.js'), 'utf8');

test('Spotlight resolves each live Twitch channel and relays its media without browser capture', () => {
  assert.match(source, /yt-dlp/);
  assert.match(source, /best\[height<=480\]\/best/);
  assert.match(source, /'-c:v', 'copy'/);
  assert.match(source, /'-c:a', 'copy'/);
  assert.match(source, /data\?\.spotlight\?\.twitchLogin/);
  assert.match(source, /delete_segments\+independent_segments\+temp_file/);
  assert.doesNotMatch(source, /puppeteer|x11grab|Twitch\.Player/);
});

test('Spotlight worker publishes only the selected generation of read-only HLS', () => {
  assert.match(server, /app\.get\('\/spotlight\/program', authorizeViewer\('spotlight'\)/);
  assert.match(server, /app\.get\('\/spotlight\/hls\/:generation\/:file', authorizeViewer\('spotlight'\)/);
  assert.match(source, /version !== generation/);
  assert.match(source, /currentLogin: login/);
  assert.match(source, /recoveryCount: recoveries/);
});
