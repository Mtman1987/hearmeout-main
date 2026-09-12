#!/usr/bin/env node

import { createHash, randomBytes, createCipheriv, publicEncrypt, constants } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const execFileAsync = promisify(execFile);
const APP = 'hearmeout-main';
const APOLLO_ROOT = resolve('apollo');
const RECENT_SNAPSHOT_MS = 30 * 60 * 1000;

function redact(value) {
  return String(value ?? '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/(FlyV1\s*)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{12,}\b/g, '[REDACTED]')
    .slice(0, 12000);
}

function decodePayload(encoded) {
  if (!/^[A-Za-z0-9+/=_-]{4,12000}$/.test(String(encoded || ''))) throw new Error('Invalid control payload encoding.');
  const value = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Control payload must be an object.');
  if (String(value.command || '').toLowerCase() !== 'hmocopy') throw new Error('Unsupported production copy command.');
  return value;
}

async function run(program, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(program, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      encoding: 'utf8',
      timeout: options.timeout ?? 180000,
      maxBuffer: 12 * 1024 * 1024,
    });
    return { ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout || ''),
      stderr: redact(error?.stderr || error?.message || error),
      exitCode: Number.isInteger(error?.code) ? error.code : 1,
    };
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

function mounts(machine) {
  return Array.isArray(machine?.config?.mounts) ? machine.config.mounts : [];
}

function hasDataMount(machine) {
  return mounts(machine).some((mount) => (mount?.path ?? mount?.destination ?? null) === '/data');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function safeSnapshot(row, reused) {
  return {
    id: row?.id ?? null,
    status: String(row?.status ?? row?.state ?? ''),
    createdAt: row?.created_at ?? row?.createdAt ?? null,
    storedSizeBytes: row?.stored_size_bytes ?? row?.storedSizeBytes ?? row?.size ?? null,
    reusedFreshSnapshot: reused,
  };
}

async function listSnapshots(volumeId) {
  const read = await fly(['volumes', 'snapshots', 'list', volumeId, '--app', APP, '--json']);
  if (!read.ok) throw new Error(read.stderr || 'Unable to list HearMeOut snapshots.');
  const parsed = parseJson(read.stdout, 'snapshot list');
  return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.snapshots) ? parsed.snapshots : []);
}

function newestCreatedSnapshot(rows, minimumCreatedMs) {
  return rows
    .filter((row) => String(row?.status ?? row?.state ?? '').toLowerCase() === 'created')
    .filter((row) => Date.parse(String(row?.created_at ?? row?.createdAt ?? '')) >= minimumCreatedMs)
    .sort((a, b) => Date.parse(String(b?.created_at ?? b?.createdAt ?? '')) - Date.parse(String(a?.created_at ?? a?.createdAt ?? '')))[0];
}

async function obtainFreshSnapshot(volumeId) {
  const recentCutoff = Date.now() - RECENT_SNAPSHOT_MS;
  const existing = newestCreatedSnapshot(await listSnapshots(volumeId), recentCutoff);
  if (existing) return safeSnapshot(existing, true);

  const beforeIds = new Set((await listSnapshots(volumeId)).map((row) => String(row?.id || '')).filter(Boolean));
  const create = await fly(['volumes', 'snapshots', 'create', volumeId, '--app', APP]);
  if (!create.ok) throw new Error(create.stderr || 'Unable to request fresh HearMeOut volume snapshot.');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const rows = await listSnapshots(volumeId);
    const candidate = rows
      .filter((row) => !beforeIds.has(String(row?.id || '')))
      .filter((row) => String(row?.status ?? row?.state ?? '').toLowerCase() === 'created')
      .sort((a, b) => Date.parse(String(b?.created_at ?? b?.createdAt ?? '')) - Date.parse(String(a?.created_at ?? a?.createdAt ?? '')))[0];
    if (candidate) return safeSnapshot(candidate, false);
    await new Promise((resolveWait) => setTimeout(resolveWait, 5000));
  }
  throw new Error('Fresh HearMeOut volume snapshot did not reach created state in time.');
}

function parseCopySentinel(raw) {
  const match = String(raw || '').match(/HMO_COPY_JSON=([A-Za-z0-9+/=]+)/);
  if (!match) throw new Error('HearMeOut copy probe did not return its sentinel.');
  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
}

async function makeApplicationCopy(machineId) {
  const source = String.raw`
(async()=>{
  const fs=require('fs'),crypto=require('crypto');
  const init=(await import('sql.js')).default;
  const SQL=await init();
  const source='/data/app.db';
  const backup='/data/app.db.bak';
  const bytes=fs.readFileSync(source);
  const db=new SQL.Database(bytes);
  const quick=db.exec('PRAGMA quick_check;')?.[0]?.values?.[0]?.[0]??'unknown';
  if(quick!=='ok')throw new Error('source quick_check failed: '+quick);
  const count=Number(db.exec('SELECT COUNT(*) FROM docs')?.[0]?.values?.[0]?.[0]||0);
  const collections=(db.exec('SELECT collection_path,COUNT(*) FROM docs GROUP BY collection_path ORDER BY collection_path')?.[0]?.values||[]).map(r=>({collection:String(r[0]),rows:Number(r[1]||0)}));
  db.close();
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const dir='/data/recovery'; fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const target=dir+'/apollo-hmo-'+stamp+'.db';
  const fd=fs.openSync(target,'wx',0o600); try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  const copied=fs.readFileSync(target);
  const verify=new SQL.Database(copied); const copiedQuick=verify.exec('PRAGMA quick_check;')?.[0]?.values?.[0]?.[0]??'unknown'; verify.close();
  if(copiedQuick!=='ok')throw new Error('copied quick_check failed: '+copiedQuick);
  const digest=crypto.createHash('sha256').update(bytes).digest('hex');
  const copiedDigest=crypto.createHash('sha256').update(copied).digest('hex');
  if(digest!==copiedDigest)throw new Error('copy digest mismatch');
  let backupInfo={present:false};
  if(fs.existsSync(backup)){const b=fs.readFileSync(backup);backupInfo={present:true,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')}}
  const out={remotePath:target,bytes:bytes.length,sha256:digest,integrity:'ok',documents:count,collections,backup:backupInfo};
  process.stdout.write('HMO_COPY_JSON='+Buffer.from(JSON.stringify(out),'utf8').toString('base64'));
})().catch(e=>{process.stderr.write(String(e?.message||e));process.exitCode=1});`;
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  const command = `node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`;
  const result = await fly(['ssh', 'console', '--app', APP, '--machine', machineId, '--command', command, '--quiet'], { timeout: 120000 });
  if (!result.ok) throw new Error(result.stderr || 'Unable to create application-consistent HearMeOut copy.');
  return parseCopySentinel(`${result.stdout}\n${result.stderr}`);
}


async function readPrivateConfiguration(app, fields, token) {
  const probe=`console.log('HMO_CONFIG='+Buffer.from(JSON.stringify(Object.fromEntries(${JSON.stringify(fields)}.map(k=>[k,process.env[k]||''])))).toString('base64'))`;
  const encoded=Buffer.from(probe).toString('base64');
  const command=`node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`;
  const result=await run('flyctl',['ssh','console','--app',app,'--command',command,'--quiet'],{env:{...process.env,FLY_API_TOKEN:token},timeout:90000});
  const match=result.stdout.match(/HMO_CONFIG=([A-Za-z0-9+/=]+)/);
  if(!result.ok||!match)throw Error('Private configuration could not be read from '+app);
  return JSON.parse(Buffer.from(match[1],'base64').toString());
}
async function verifyIdleWorker() {
 const probe=String.raw`(async()=>{const headers={Authorization:'Bearer '+process.env.HMO_WORKER_SHARED_SECRET};const read=async p=>{const r=await fetch('http://127.0.0.1:3002'+p,{headers,signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Worker inventory unavailable');return r.json()};const h=await read('/health'),v=await read('/voice-bridge');if(h.activeDJs!==0||!Array.isArray(v.instances)||v.instances.length!==0)throw Error('Worker is busy; export stopped');console.log('HMO_IDLE_OK')})().catch(()=>{process.exitCode=1})`;
 const encoded=Buffer.from(probe).toString('base64');
 const result=await run('flyctl',['ssh','console','--app','hmo-dj-worker','--command',`node -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`,'--quiet'],{env:{...process.env,FLY_API_TOKEN:process.env.HMO_FLY_WORKER_TOKEN},timeout:90000});
 if(!result.ok||!result.stdout.includes('HMO_IDLE_OK'))throw Error('Worker is not verified idle');
}
async function main(){
 const root=mkdtempSync(join(tmpdir(),'apollo-hmo-transfer-'));
 try{
  await verifyIdleWorker();
  const listed=await fly(['machines','list','--app',APP,'--json']);
  if(!listed.ok)throw Error('Machine inventory failed');
  const active=parseJson(listed.stdout,'machine inventory').filter(m=>m.state==='started'&&hasDataMount(m));
  if(active.length!==1)throw Error('Expected one active main data machine');
  const machine=active[0],volumeId=String(mounts(machine).find(m=>(m.path??m.destination)==='/data').volume);
  const snapshot=await obtainFreshSnapshot(volumeId);
  const copy=await makeApplicationCopy(machine.id);
  const localDb=join(root,'blue.db');
  const download=await fly(['ssh','sftp','get',copy.remotePath,localDb,'--app',APP,'--machine',machine.id,'--quiet']);
  if(!download.ok||sha256(readFileSync(localDb))!==copy.sha256)throw Error('Recovery copy verification failed');
  const {buildHearMeOutBlueMigrationBundle}=await import(pathToFileURL(join(APOLLO_ROOT,'scripts/build-hearmeout-blue-migration-bundle.mjs')).href);
  const bundle=buildHearMeOutBlueMigrationBundle(localDb);
  const main=await readPrivateConfiguration(APP,['LIVEKIT_URL','NEXT_PUBLIC_LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET'],process.env.FLY_API_TOKEN);
  const worker=await readPrivateConfiguration('hmo-dj-worker',['HMO_WORKER_SHARED_SECRET'],process.env.HMO_FLY_WORKER_TOKEN);
  const configuration={workerOrigin:'https://hmo-dj-worker.fly.dev',workerAuthorization:'Bearer '+worker.HMO_WORKER_SHARED_SECRET,livekitUrl:main.LIVEKIT_URL||main.NEXT_PUBLIC_LIVEKIT_URL,livekitApiKey:main.LIVEKIT_API_KEY,livekitApiSecret:main.LIVEKIT_API_SECRET};
  if(!/^Bearer .{16,}$/.test(configuration.workerAuthorization)||!/^wss:\/\//.test(configuration.livekitUrl)||!configuration.livekitApiKey||!configuration.livekitApiSecret)throw Error('Existing HearMeOut provider configuration is incomplete');
  const payload={schemaVersion:1,createdAt:new Date().toISOString(),bundle,configuration,recovery:{...copy,snapshot:{volumeId,...snapshot}}};
  const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final()]);
  const capsule={schemaVersion:1,wrappedKey:publicEncrypt({key:readFileSync('scripts/hmo-transfer-public.pem'),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')};
  console.log('HMO_ENCRYPTED_TRANSFER='+Buffer.from(JSON.stringify(capsule)).toString('base64'));
  console.log(JSON.stringify({ok:true,documents:bundle.sourceDocuments,sharedIdentityDocuments:bundle.reconciliation.spmtUserDocuments,rebuiltPresenceDocuments:bundle.reconciliation.rebuildPresenceDocuments,legacyConfigDocuments:bundle.legacyConfig.documents,integrity:bundle.integrity,sourceDatabaseSha256:bundle.sourceDatabaseSha256,blueRemainsAuthoritative:true}));
 }catch(error){console.error(String(error.message||error).replace(/(?:Bearer|FlyV1)\s+\S+/g,'[REDACTED]'));process.exitCode=1}
 finally{rmSync(root,{recursive:true,force:true})}
}
void main();
