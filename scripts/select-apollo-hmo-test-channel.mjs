import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const source=String.raw`(async()=>{
 const {Client,GatewayIntentBits,ChannelType}=require('discord.js');
 const auth={Authorization:'Bearer '+process.env.HMO_WORKER_SHARED_SECRET};
 const read=async p=>{const r=await fetch('http://127.0.0.1:3002'+p,{headers:auth,signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Worker status unavailable');return r.json()};
 const h=await read('/health'),v=await read('/voice-bridge');
 if(h.activeDJs!==0||!Array.isArray(v.instances)||v.instances.length!==0)throw Error('Worker is busy');
 let token=process.env.DISCORD_BOT_TOKEN;
 if(!token){const r=await fetch((process.env.APP_URL||'https://hearmeout-main.fly.dev').replace(/\/+$/,'')+'/api/discord/bot-token',{headers:auth,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Bot broker unavailable');token=(await r.json()).token;}
 const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]});
 try{
  await client.login(token);
  if(!client.isReady())await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Discord readiness timed out')),20000);client.once('clientReady',()=>{clearTimeout(timer);resolve()})});
  const candidates=[];
  for(const guild of client.guilds.cache.values()){
   await guild.channels.fetch();
   if(guild.voiceStates.cache.get(client.user.id)?.channelId)throw Error('Bot is already connected');
   for(const channel of guild.channels.cache.values()){
    if(channel.type!==ChannelType.GuildVoice||(channel.members?.size??-1)!==0)continue;
    const kind=[['canary',/canary/i],['test',/\btest(?:ing)?\b/i],['sandbox',/sandbox/i]].find(([,r])=>r.test(channel.name));
    if(kind)candidates.push({guildId:String(guild.id),voiceChannelId:String(channel.id),kind:kind[0]});
   }
  }
  candidates.sort((a,b)=>a.guildId.localeCompare(b.guildId)||a.voiceChannelId.localeCompare(b.voiceChannelId));
  if(!candidates.length)throw Error('No empty test voice channel is available');
  const out={ok:true,...candidates[0],checkedAt:new Date().toISOString(),activeDJs:0,activeBridges:0,selectedChannelWasEmpty:true,workerBridgeSha256:require('crypto').createHash('sha256').update(require('fs').readFileSync('/app/src/discord-voice-bridge.js')).digest('hex')};
  console.log('HMO_TEST_TARGET='+Buffer.from(JSON.stringify(out)).toString('base64'));
 }finally{client.destroy()}
})().catch(e=>{console.log('HMO_TEST_TARGET='+Buffer.from(JSON.stringify({ok:false,error:String(e.message).replace(/(?:Bearer|FlyV1)\s+\S+/g,'[REDACTED]')})).toString('base64'));process.exitCode=1})`;
try{
 const listed=await run('flyctl',['machines','list','--app','hmo-dj-worker','--json'],{timeout:60000});
 const machines=JSON.parse(listed.stdout).filter(m=>m.state==='started');if(machines.length!==1)throw Error('Expected one started worker');
 const encoded=Buffer.from(source).toString('base64');
 const result=await run('flyctl',['ssh','console','--app','hmo-dj-worker','--machine',machines[0].id,'--quiet','--command',`node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`],{timeout:90000,maxBuffer:1024*1024});
 const match=result.stdout.match(/HMO_TEST_TARGET=([A-Za-z0-9+/=]+)/);if(!match)throw Error('No verified test target returned');
 console.log('HMO_TEST_TARGET='+match[1]);
}catch{console.error('Live worker test-channel inspection failed');process.exitCode=1;}
