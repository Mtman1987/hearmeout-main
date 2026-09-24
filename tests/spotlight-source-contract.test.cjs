const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const test=require('node:test');

const source=readFileSync(resolve(__dirname,'../worker/src/spotlight-broadcast.js'),'utf8');
const server=readFileSync(resolve(__dirname,'../worker/src/server.js'),'utf8');

test('Spotlight owns one persistent Twitch player and rotates channels without replacing it',()=>{
 assert.match(source,/new Twitch\.Player\('player'/);
 assert.match(source,/player\.setChannel\(clean\)/);
 assert.match(source,/window\.spotlightSource\.activated=true/);
 assert.match(source,/page\.click\('#start'\)/);
 assert.match(source,/content-classification-gate-overlay-start-watching-button/);
 assert.match(source,/Array\.from\(document\.querySelectorAll\('button'\)\)/);
 assert.doesNotMatch(source,/frame\.\$\('button'\)/);
 assert.match(source,/warningCleared: clicked/);
 assert.equal((source.match(/new Twitch\.Player\(/g)||[]).length,1);
 assert.match(source,/x11grab/);
 assert.match(source,/ignoreDefaultArgs: \['--mute-audio', '--enable-automation'\]/);
 assert.match(source,/--disable-infobars/);
 assert.match(source,/spotlight\.monitor/);
 assert.match(source,/delete_segments\+omit_endlist/);
 assert.match(source,/getPlaybackStats/);
 assert.doesNotMatch(source,/getCurrentTime/);
 assert.match(source,/live-fps-stalled/);
 assert.match(source,/stalledFor>=12000/);
 assert.match(source,/function createPlayer\(login\)/);
 assert.equal((source.match(/new Twitch\.Player\(/g)||[]).length,1);
 assert.match(source,/typeof q===['"]string['"]\?q:/);
 assert.match(source,/'-framerate', '30'/);
 assert.match(source,/'-preset', 'superfast'/);
 assert.match(source,/'-hls_time', '1'/);
});

test('Spotlight worker routes are authenticated and expose only status start and HLS',()=>{
 assert.match(server,/app\.get\('\/spotlight\/status', authorizeWorker/);
 assert.match(server,/app\.post\('\/spotlight\/start', authorizeWorker/);
 assert.match(server,/app\.post\('\/spotlight\/consent', authorizeWorker/);
 assert.match(server,/app\.get\('\/spotlight\/hls\/:file', authorizeWorker/);
});

test('Spotlight status exposes live render health so stalls are observable',()=>{
 assert.match(source,/fps: Number\(window\.spotlightSource\?\.fps/);
 assert.match(source,/bufferSize: Number\(window\.spotlightSource\?\.bufferSize/);
 assert.match(source,/playbackRate: Number\(window\.spotlightSource\?\.playbackRate/);
 assert.match(source,/recoveryCount: Number\(window\.spotlightSource\?\.recoveryCount/);
 assert.match(source,/lastRecoveryReason: window\.spotlightSource\?\.lastRecoveryReason/);
});
