'use strict';

const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'src', 'discord-voice-bridge.js');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const readyMarker = `    bridgesByChannel.set(this.voiceChannelId, this);\n    console.log(\`[VoiceBridge:\${this.roomId}] Joined Discord voice channel \${this.voiceChannelId}\`);\n\n    await this.startOrRepairPlayback('post-discord-join');`;
const readyReplacement = `    bridgesByChannel.set(this.voiceChannelId, this);\n\n    // Discord Stage channels can connect successfully while the bot remains\n    // suppressed. Try to become a speaker when permissions allow it; if not,\n    // expose the real suppression state in status instead of pretending audio\n    // is available.\n    if (channel.type === ChannelType.GuildStageVoice) {\n      const botVoiceState = this.guild.voiceStates.cache.get(this.client.user.id);\n      if (botVoiceState?.suppress) {\n        try {\n          await botVoiceState.setSuppressed(false);\n          console.log(\`[VoiceBridge:\${this.roomId}] Stage suppression cleared\`);\n        } catch (err) {\n          console.warn(\`[VoiceBridge:\${this.roomId}] Could not clear Stage suppression: \${err?.message || err}\`);\n        }\n      }\n    }\n\n    console.log(\`[VoiceBridge:\${this.roomId}] Joined Discord voice channel \${this.voiceChannelId}\`);\n\n    await this.startOrRepairPlayback('post-discord-join');`;

if (!source.includes('Stage suppression cleared')) {
  if (!source.includes(readyMarker)) throw new Error('Discord voice ready marker missing');
  source = source.replace(readyMarker, readyReplacement);
}

const statusMarker = `  status() {\n    const jitterSources = Array.from(this.discordMixSources.values()).map((src) => src.snapshot());`;
const statusReplacement = `  status() {\n    const botVoiceState = this.guild?.voiceStates?.cache?.get(this.client?.user?.id);\n    const jitterSources = Array.from(this.discordMixSources.values()).map((src) => src.snapshot());`;
if (!source.includes('const botVoiceState = this.guild?.voiceStates?.cache')) {
  if (!source.includes(statusMarker)) throw new Error('Voice bridge status marker missing');
  source = source.replace(statusMarker, statusReplacement);
}

const fieldsMarker = `      roomVoiceOutboundEnabled: this.roomVoiceOutboundEnabled,\n      mode: this.roomVoiceOutboundEnabled ? 'two-way' : 'listen-only',\n      audioProfile: this.audioProfile,`;
const fieldsReplacement = `      roomVoiceOutboundEnabled: this.roomVoiceOutboundEnabled,\n      mode: this.roomVoiceOutboundEnabled ? 'two-way' : 'listen-only',\n      discordSelfMute: Boolean(botVoiceState?.selfMute),\n      discordServerMute: Boolean(botVoiceState?.serverMute),\n      discordSuppressed: Boolean(botVoiceState?.suppress),\n      audioProfile: this.audioProfile,`;
if (!source.includes('discordServerMute: Boolean(botVoiceState?.serverMute)')) {
  if (!source.includes(fieldsMarker)) throw new Error('Voice bridge status field marker missing');
  source = source.replace(fieldsMarker, fieldsReplacement);
}

for (const marker of [
  'Stage suppression cleared',
  'discordSelfMute: Boolean(botVoiceState?.selfMute)',
  'discordServerMute: Boolean(botVoiceState?.serverMute)',
  'discordSuppressed: Boolean(botVoiceState?.suppress)',
]) {
  if (!source.includes(marker)) throw new Error(`Voice bridge audio-state marker missing: ${marker}`);
}

fs.writeFileSync(file, source, 'utf8');
console.log('Voice bridge audio-state patch applied.');
