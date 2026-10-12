import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicPlaylistUrl, nextBackupEntry } from '../src/lib/twitch-backup-playlist';
process.env.WATCH_STATE_FILE=join(mkdtempSync(join(tmpdir(),'backup-playlist-')),'state.json');

test('playlist imports accept only YouTube playlist URLs and rotate every entry', () => {
 assert.equal(publicPlaylistUrl('https://www.youtube.com/watch?v=abcdefghijk&list=PL1234567890'),'https://www.youtube.com/playlist?list=PL1234567890');
 assert.throws(()=>publicPlaylistUrl('https://example.com/playlist?list=PL1234567890'));
 const playlist:any={enabled:true,cursor:0,entries:[{id:'a'},{id:'b'}]};
 assert.equal(nextBackupEntry(playlist)?.id,'a');assert.equal(nextBackupEntry(playlist)?.id,'b');assert.equal(nextBackupEntry(playlist)?.id,'a');
 playlist.enabled=false;assert.equal(nextBackupEntry(playlist),null);
});
test('requests play before fallback, natural end resumes it, and stale end cannot advance again', async () => {
 const originalFetch=globalThis.fetch; globalThis.fetch=(async()=>new Response('',{status:200})) as typeof fetch;
 const {getWatchSession,controlWatchSession,controlTwitchBackupPlaylist}=await import('../src/lib/watch-request-service');
 const a=getWatchSession('watch-twitch-fatkid-music'),b=getWatchSession('watch-twitch-other-music'),lounge=getWatchSession('discord-music-room');
 const item:any={id:'test',title:'Requested',type:'music',runtime:'3m',metadata:{},playbackUrl:'/fixture.mp4'};
 a.backupPlaylist={enabled:true,title:'Backup',url:'https://www.youtube.com/playlist?list=PL1234567890',cursor:0,entries:[{id:'abcdefghijk',title:'Backup A',duration:180000,artist:'Artist',thumbnail:''},{id:'lmnopqrstuv',title:'Backup B',duration:180000,artist:'Artist',thumbnail:''}]};
 a.current={requestId:'old',item,requestedBy:{userId:'human',username:'Human'}} as any;
 a.queue=[{requestId:'human-next',item,requestedBy:{userId:'human',username:'Human'}} as any];
 b.current={requestId:'other-current',item} as any;lounge.current={requestId:'lounge-current',item} as any;
 await controlWatchSession(a.id,'next',undefined,undefined,{isAdmin:true,expectedRequestId:'old'});
 assert.equal(a.current?.requestId,'human-next');
 await controlWatchSession(a.id,'next',undefined,undefined,{isAdmin:true,expectedRequestId:'human-next'});
 assert.equal(a.current?.item.title,'Backup A');
 const id=a.current?.requestId;
 await controlWatchSession(a.id,'next',undefined,undefined,{isAdmin:true,expectedRequestId:'human-next'});
 assert.equal(a.current?.requestId,id);assert.equal(a.backupPlaylist.cursor,1);
 await controlWatchSession(a.id,'next',undefined,undefined,{isAdmin:true});
 assert.equal(a.current?.item.title,'Backup B');
 await controlTwitchBackupPlaylist(a.id,'off');
 assert.equal(a.current,null);assert.equal(a.backupPlaylist.enabled,false);
 assert.equal(b.current?.requestId,'other-current');assert.equal(lounge.current?.requestId,'lounge-current');
 await assert.rejects(controlTwitchBackupPlaylist(lounge.id,'on'),/Twitch/);
 globalThis.fetch=originalFetch;
});
