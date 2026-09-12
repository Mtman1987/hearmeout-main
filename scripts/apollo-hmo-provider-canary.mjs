#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const APP = 'hmo-dj-worker';

function redact(value) {
  return String(value ?? '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/(FlyV1\s*)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/((?:token|authorization|secret|password))\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 12000);
}

function decodePayload(encoded) {
  if (!/^[A-Za-z0-9+/=_-]{4,12000}$/.test(String(encoded || ''))) throw new Error('Invalid control payload encoding.');
  const value = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value) || String(value.command || '').toLowerCase() !== 'hmocanary') {
    throw new Error('Unsupported HMO provider canary command.');
  }
  return value;
}

async function run(program, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(program, args, {
      env: options.env || process.env,
      encoding: 'utf8',
      timeout: options.timeout ?? 180000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') };
  } catch (error) {
    return { ok: false, stdout: String(error?.stdout || ''), stderr: redact(error?.stderr || error?.message || error) };
  }
}

async function fly(args, options = {}) {
  const token = String(process.env.FLY_API_TOKEN || '');
  if (!token) throw new Error('FLY_API_TOKEN is unavailable.');
  return run('flyctl', args, { ...options, env: { ...process.env, FLY_API_TOKEN: token } });
}

function parseJson(text, label) {
  try { return JSON.parse(String(text || '').trim() || 'null'); }
  catch { throw new Error(`${label} returned malformed JSON.`); }
}

function parseSentinel(raw) {
  const match = String(raw || '').match(/HMO_PROVIDER_CANARY_JSON=([A-Za-z0-9+/=]+)/);
  if (!match) throw new Error('HearMeOut provider canary did not return its sentinel.');
  return parseJson(Buffer.from(match[1], 'base64').toString('utf8'), 'HearMeOut provider canary sentinel');
}

const REMOTE_CANARY = String.raw`
(async()=>{
  const {Client,GatewayIntentBits,ChannelType}=require('discord.js');
  const expectedBridgeSha256='8185759bb6a6c03732f2c4c76de47a466b4d6d0f3f1dd2f4a491e75ec3d59a9c';
  const actualBridgeSha256=require('crypto').createHash('sha256').update(require('fs').readFileSync('/app/src/discord-voice-bridge.js')).digest('hex');
  if(actualBridgeSha256!==expectedBridgeSha256)throw new Error('worker revision does not include the verified cleanup fix');
  const secret=String(process.env.HMO_WORKER_SHARED_SECRET||'').trim();
  if(secret.length<16)throw new Error('worker shared secret unavailable');
  const auth={Authorization:'Bearer '+secret,Accept:'application/json'};
  const read=async(path)=>{const response=await fetch('http://127.0.0.1:3002'+path,{headers:auth,signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('worker preflight/status failed ('+response.status+')');return response.json()};
  const health=await read('/health');
  const prior=await read('/voice-bridge');
  if(health.activeDJs!==0||!Array.isArray(prior.instances)||prior.instances.length!==0)throw new Error('worker is busy; canary refused');
  const step=async(name,fn)=>{try{return await fn()}catch(e){throw new Error(name+': '+String(e?.message||e))}};
  let token=String(process.env.DISCORD_BOT_TOKEN||'').trim();
  let tokenSource='worker-env';
  if(!token){
    tokenSource='broker';
    const appUrl=String(process.env.APP_URL||'https://hearmeout-main.fly.dev').replace(/\/+$/,'');
    const tokenResponse=await step('token-broker',()=>fetch(appUrl+'/api/discord/bot-token',{headers:auth,signal:AbortSignal.timeout(15000)}));
    if(!tokenResponse.ok)throw new Error('token-broker: unavailable ('+tokenResponse.status+')');
    token=String((await tokenResponse.json()).token||'');
    if(!token)throw new Error('token-broker: returned no token');
  }

  const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]});
  let roomId='';let startAttempted=false;let started=false;let stopped=false;let running=false;let candidateKind='';let listenOnly=false;let startupGainConfirmed=false;let updateGainConfirmed=false;let failure='';
  const post=async(path,body,timeout=25000)=>step('worker '+path,async()=>{
    const response=await fetch('http://127.0.0.1:3002'+path,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.success===false)throw new Error('failed ('+response.status+', '+(/429|too many requests|rate.?limit/i.test(String(payload.message||''))?'provider-rate-limit':'worker-error')+')');
    return payload;
  });
  try{
    await step('discord-login',()=>client.login(token));
    if(!client.isReady())await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('discord-ready: timeout')),20000);client.once('clientReady',()=>{clearTimeout(timer);resolve()})});
    const patterns=[['canary',/canary/i],['test',/\btest(?:ing)?\b/i],['sandbox',/sandbox/i]];
    const candidates=[];
    for(const guild of client.guilds.cache.values()){
      await step('discord-channel-fetch',()=>guild.channels.fetch());
      if(guild.voiceStates.cache.get(client.user.id)?.channelId)throw new Error('Discord bot is already connected; canary refused');
      for(const channel of guild.channels.cache.values()){
        if(channel.type!==ChannelType.GuildVoice&&channel.type!==ChannelType.GuildStageVoice)continue;
        const memberCount=channel.members?.size??0;
        if(memberCount!==0)continue;
        const matched=patterns.find(([,regex])=>regex.test(String(channel.name||'')));
        if(!matched)continue;
        candidates.push({guildId:String(guild.id),voiceChannelId:String(channel.id),kind:matched[0],score:patterns.findIndex(([name])=>name===matched[0])});
      }
    }
    candidates.sort((a,b)=>a.score-b.score||a.guildId.localeCompare(b.guildId)||a.voiceChannelId.localeCompare(b.voiceChannelId));
    const candidate=candidates[0];
    if(!candidate)throw new Error('channel-selection: no empty canary/test/sandbox Discord voice channel is available');
    candidateKind=candidate.kind;
    const selected=await client.guilds.cache.get(candidate.guildId).channels.fetch(candidate.voiceChannelId);
    if((selected.members?.size??-1)!==0)throw new Error('selected test channel is no longer empty');
    const lastCheck=await read('/voice-bridge');
    if(!Array.isArray(lastCheck.instances)||lastCheck.instances.length!==0)throw new Error('worker became busy; canary refused');
    roomId='apollo-canary-'+Date.now();
    startAttempted=true;
    const start=await post('/voice-bridge',{action:'start',roomId,guildId:candidate.guildId,voiceChannelId:candidate.voiceChannelId,audioProfile:'balanced',discordReceiveGain:0.23},120000);
    startupGainConfirmed=start.status?.discordReceiveGain===0.23;
    started=true;
    const gate=await post('/voice-bridge/gate',{roomId,roomVoiceOutboundEnabled:false});
    listenOnly=(gate.status||gate).roomVoiceOutboundEnabled===false;
    if(!startupGainConfirmed||!listenOnly)throw new Error('startup gain/privacy was not confirmed');
    const gain=await post('/voice-bridge/receive-gain',{roomId,discordReceiveGain:0.41});
    updateGainConfirmed=gain.status?.discordReceiveGain===0.41;
    if(!updateGainConfirmed)throw new Error('updated gain was not confirmed');
    await new Promise(r=>setTimeout(r,8000));
    const statusResponse=await step('worker status',()=>fetch('http://127.0.0.1:3002/voice-bridge?roomId='+encodeURIComponent(roomId),{headers:auth,signal:AbortSignal.timeout(15000)}));
    const status=statusResponse.ok?await statusResponse.json():{};
    running=status.running===true&&status.discordReceiveGain===0.41&&status.roomVoiceOutboundEnabled===false;
  }catch(e){failure=String(e?.message||e)}finally{
    if(startAttempted&&roomId){try{await post('/voice-bridge',{action:'stop',roomId},150000);
      await new Promise(r=>setTimeout(r,3000));
      const final=await read('/voice-bridge?roomId='+encodeURIComponent(roomId));
      stopped=final.running===false;
      if(!stopped)throw new Error('bridge remained running after stop')}catch(e){failure=(failure?failure+'; ':'')+'cleanup-stop: '+String(e?.message||e)}}
    try{client.destroy()}catch{}
  }
  const out={ok:started&&running&&listenOnly&&startupGainConfirmed&&updateGainConfirmed&&stopped&&!failure,blueRemainsAuthoritative:true,dnsChanged:false,providerCanary:true,tokenSource,candidateKind,selectedChannelWasEmpty:Boolean(candidateKind),productionChannelReused:false,startAttempted,bridgeStarted:started,startupGainConfirmed,updateGainConfirmed,listenOnly,runningObserved:running,bridgeStopped:stopped,canaryRoomEphemeral:true,...(failure?{error:failure.replace(/((?:token|authorization|secret|password))\s*[:=]\s*\S+/gi,'$1=[REDACTED]').slice(0,500)}:{})};
  process.stdout.write('HMO_PROVIDER_CANARY_JSON='+Buffer.from(JSON.stringify(out),'utf8').toString('base64'));
  if(!out.ok)process.exitCode=1;
})().catch(e=>{const out={ok:false,blueRemainsAuthoritative:true,dnsChanged:false,providerCanary:true,error:String(e?.message||e).replace(/((?:token|authorization|secret|password))\s*[:=]\s*\S+/gi,'$1=[REDACTED]').slice(0,500)};process.stdout.write('HMO_PROVIDER_CANARY_JSON='+Buffer.from(JSON.stringify(out),'utf8').toString('base64'));process.exitCode=1});
`;

async function main() {
  try {
    decodePayload(process.argv[2]);
    const machinesRead = await fly(['machines', 'list', '--app', APP, '--json']);
    if (!machinesRead.ok) throw new Error(machinesRead.stderr || 'Unable to list HMO worker Machines.');
    const machines = parseJson(machinesRead.stdout, 'HMO worker Machines list');
    const active = (Array.isArray(machines) ? machines : []).filter((machine) => machine?.state === 'started');
    if (active.length !== 1) throw new Error(`Expected exactly one started HMO worker; found ${active.length}.`);
    const encoded = Buffer.from(REMOTE_CANARY, 'utf8').toString('base64');
    const command = `node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`;
    const result = await fly(['ssh', 'console', '--app', APP, '--machine', String(active[0].id), '--command', command, '--quiet'], { timeout: 360000 });
    const output = parseSentinel(`${result.stdout}\n${result.stderr}`);
    process.stdout.write(JSON.stringify(output, null, 2));
    if (!output.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, blueRemainsAuthoritative: true, dnsChanged: false, providerCanary: true, error: redact(error instanceof Error ? error.message : error) }, null, 2));
    process.exitCode = 1;
  }
}

void main();
