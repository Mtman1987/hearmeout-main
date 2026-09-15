'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { DiscordSpeakerPresence } = require('../worker/src/discord-speaker-presence');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('one mixed publisher lists usernames and follows the current Discord speaker avatar', async () => {
  const updates = [];
  const presence = new DiscordSpeakerPresence({resolveMember: async id => ({displayName:`Name ${id}`,username:`user${id}`,photoURL:`https://cdn.discordapp.com/${id}.png`}),publish:async state => updates.push(state)});
  try {
    presence.join('1'); presence.join('2'); await settle();
    assert.deepEqual(presence.snapshot().discordMembers.map(m => m.username), ['user1','user2']);
    presence.speaking('1',true); await presence.flush(); assert.equal(updates.at(-1).displayName,'Name 1'); assert.equal(updates.at(-1).photoURL,'https://cdn.discordapp.com/1.png');
    presence.speaking('2',true); assert.equal(presence.snapshot().displayName,'Name 2');
    presence.speaking('2',false); assert.equal(presence.snapshot().displayName,'Name 1');
    presence.leave('1'); assert.equal(presence.snapshot().displayName,'Discord VC'); assert.equal(presence.snapshot().memberCount,1);
    presence.speaking('2',true); presence.speaking('2',false); assert.deepEqual(presence.snapshot().activeSpeakers,[]);
  } finally { presence.close(); }
});

test('slow member lookup cannot restore a departed user; metadata includes larger room rosters',async()=>{
  let resolve;const presence=new DiscordSpeakerPresence({resolveMember:()=>new Promise(r=>resolve=r),publish:async()=>{}});
  try{presence.join('late');await settle();presence.leave('late');resolve({displayName:'Gone'});await settle();assert.equal(presence.snapshot().memberCount,0)}finally{presence.close()}
  const large=new DiscordSpeakerPresence({resolveMember:async id=>({displayName:id,username:id,photoURL:'https://cdn.discordapp.com/'+ 'a'.repeat(800)}),publish:async()=>{}});
  try{for(let i=0;i<99;i++)large.join(String(i));await settle();const state=large.snapshot();assert.equal(state.discordMembers.length,99);assert.ok(Buffer.byteLength(JSON.stringify(state))<15000)}finally{large.close()}
});

test('concurrent metadata changes are serialized and the latest speaker is retained',async()=>{
  let release;const updates=[];const presence=new DiscordSpeakerPresence({resolveMember:async id=>({displayName:id}),publish:async state=>{updates.push(state);if(updates.length===1)await new Promise(r=>release=r)}});
  try{presence.join('a');await settle();const pending=presence.flush();presence.speaking('a',true);await presence.flush();assert.equal(updates.length,1);release();await pending;await presence.flush();assert.deepEqual(updates.at(-1).activeSpeakers,['a'])}finally{presence.close()}
});

test('only internal bridge tokens can update their own speaker metadata',()=>{
  const source=readFileSync('src/app/api/livekit-token/route.ts','utf8');
  const block=source.slice(source.indexOf('if (voiceBridge && fromDjWorker)'),source.indexOf('// Bind user-browser tokens'));
  assert.match(block,/canUpdateOwnMetadata: true/);assert.equal((source.match(/canUpdateOwnMetadata: true/g)||[]).length,1);
});
