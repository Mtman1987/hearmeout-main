const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const test=require('node:test');

const source=readFileSync(resolve(__dirname,'../worker/src/spotlight-broadcast.js'),'utf8');
const server=readFileSync(resolve(__dirname,'../worker/src/server.js'),'utf8');

test('Spotlight owns one persistent Twitch player and rotates channels without replacing it',()=>{
 assert.match(source,/new Twitch\.Player\('spotlight-twitch-player'/);
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
 assert.match(source,/SPOTLIGHT_PROFILE_DIR/);
 assert.match(source,/\/data\/spotlight-chromium/);
 assert.match(source,/#spotlight-twitch-player/);
 assert.match(source,/clearContentWarning/);
 assert.match(source,/spotlight\.monitor/);
 assert.match(source,/frag_keyframe\+empty_moov\+default_base_moof/);
 assert.match(source,/function watch\(response\)/);
 assert.match(source,/function framePacket\(payload\)/);
 assert.match(source,/getPlaybackStats/);
 assert.doesNotMatch(source,/getCurrentTime/);
 assert.match(source,/live-playback-stalled/);
 assert.match(source,/stalledFor>=12000/);
 assert.match(source,/function createPlayer\(login\)/);
 assert.equal((source.match(/new Twitch\.Player\(/g)||[]).length,1);
 assert.match(source,/720p30/);
 assert.match(source,/'-framerate', '30'/);
 assert.match(source,/'-preset', 'ultrafast'/);
});

test('Spotlight worker routes expose one authenticated live feed',()=>{
 assert.match(server,/app\.get\('\/spotlight\/status', authorizeSpotlight/);
 assert.match(server,/app\.post\('\/spotlight\/start', authorizeSpotlight/);
 assert.match(server,/app\.post\('\/spotlight\/consent', authorizeSpotlight/);
 assert.match(server,/app\.get\('\/spotlight\/live\.mp4', authorizeSpotlight/);
 assert.match(server,/setInterval\(keepSpotlightRunning, 15000\)/);
});

test('Spotlight status exposes render health and recovery telemetry',()=>{
 assert.match(source,/fps: Number\(window\.spotlightSource\?\.fps/);
 assert.match(source,/bufferSize: Number\(window\.spotlightSource\?\.bufferSize/);
 assert.match(source,/playbackRate: Number\(window\.spotlightSource\?\.playbackRate/);
 assert.match(source,/recoveryCount: Number\(window\.spotlightSource\?\.recoveryCount/);
 assert.match(source,/lastRecoveryReason: window\.spotlightSource\?\.lastRecoveryReason/);
});
