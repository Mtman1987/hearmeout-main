import { db, ensureDb } from '@/lib/db';
import { canManageRoom } from '@/lib/room-access';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';
import { ensureDiscordActivityRoom } from '@/lib/activity-room';
import { isActivityRoomId } from '@/lib/watch-session';

export type ServiceBotPersona = {
  id?: string;
  name: string;
  ownerName?: string;
  ownerTenantId: string;
  aliases?: string[];
  wakeNames?: string[];
  interests?: string[];
  voice?: string;
  livekitTtsDescriptor?: string;
  avatar?: string;
  idleAvatar?: string;
  talkingAvatar?: string;
  canInvite?: boolean;
};

type ServiceActor = {
  actorUserId?: string;
  tenantId?: string;
  actorRole?: string;
};

type VoiceBridgeConfig = {
  enabled: boolean;
  guildId: string;
  voiceChannelId: string;
  roomVoiceOutboundEnabled: boolean;
  audioProfile: 'low-latency' | 'balanced' | 'resilient';
  updatedBy?: string;
  updatedAt?: string;
};

function text(value: unknown, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function normalize(value: unknown) {
  return text(value, 500).toLowerCase();
}

function readVoiceBridgeConfig(room: any): VoiceBridgeConfig {
  const raw = room?.voiceBridge || {};
  return {
    enabled: Boolean(raw.enabled),
    guildId: text(raw.guildId, 80),
    voiceChannelId: text(raw.voiceChannelId, 80),
    roomVoiceOutboundEnabled: typeof raw.roomVoiceOutboundEnabled === 'boolean' ? raw.roomVoiceOutboundEnabled : true,
    audioProfile: ['low-latency', 'balanced', 'resilient'].includes(String(raw.audioProfile))
      ? raw.audioProfile
      : 'balanced',
    updatedBy: text(raw.updatedBy, 160) || undefined,
    updatedAt: text(raw.updatedAt, 80) || undefined,
  };
}

async function callWorker(path: string, init?: RequestInit) {
  const url = getDjWorkerUrl();
  if (!url) throw new Error('HearMeOut worker is not configured.');
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: getDjWorkerRequestHeaders({ 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers || {}) }),
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined,
  }).catch(() => null);
  if (!response) throw new Error('HearMeOut worker is unavailable.');
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success === false) {
    throw new Error(text(body?.error || body?.message || `HearMeOut worker returned ${response.status}`, 1000));
  }
  return body;
}

async function resolveActor(actor: ServiceActor) {
  await ensureDb();
  const rawActor = text(actor.actorUserId, 160);
  const tenantId = text(actor.tenantId, 160);
  const candidateIds = new Set([
    rawActor,
    tenantId,
    rawActor && `discord_${rawActor}`,
    tenantId && `twitch_${tenantId}`,
  ].filter(Boolean));
  const users = await db.collection('users').get();
  for (const doc of users.docs) {
    const row = doc.data() || {};
    if (
      candidateIds.has(doc.id)
      || candidateIds.has(text(row.discordId, 160))
      || candidateIds.has(text(row.twitchId, 160))
      || candidateIds.has(text(row.spmtUserId, 160))
    ) {
      return { uid: doc.id, ...row };
    }
  }
  return { uid: rawActor || tenantId, isAdmin: false };
}

function canActorManageRoom(actor: any, room: any, serviceActor: ServiceActor) {
  const ownerId = text(room?.ownerId || room?.createdBy || room?.hostId, 160);
  return canManageRoom(actor, ownerId)
    || (serviceActor.actorRole === 'owner' && text(room?.ownerTenantId, 160) === text(serviceActor.tenantId, 160));
}

async function roomRows() {
  await ensureDb();
  const snapshot = await db.collection('rooms').get();
  return snapshot.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() || {}) }));
}

export async function listRoomsForBotAction(actorInput: ServiceActor) {
  const actor = await resolveActor(actorInput);
  const rows = await roomRows();
  return rows
    .filter((room: any) => !room.isPrivate || canActorManageRoom(actor, room, actorInput))
    .map((room: any) => ({
      id: room.id,
      name: text(room.name, 120) || room.id,
      description: text(room.description, 300),
      isPrivate: Boolean(room.isPrivate),
      owned: canActorManageRoom(actor, room, actorInput),
      occupantCount: Number(room.occupantCount || 0),
      voiceBridge: readVoiceBridgeConfig(room),
    }))
    .sort((left: any, right: any) => Number(right.owned) - Number(left.owned) || left.name.localeCompare(right.name));
}

export async function resolveManagedRoomForBotAction(selector: string | undefined, actorInput: ServiceActor) {
  const actor = await resolveActor(actorInput);
  const rows = await roomRows();
  const requested = normalize(selector);
  let candidates = rows.filter((room: any) => canActorManageRoom(actor, room, actorInput));
  if (requested) {
    const exact = candidates.filter((room: any) => normalize(room.id) === requested || normalize(room.name) === requested);
    candidates = exact.length ? exact : candidates.filter((room: any) => normalize(room.name).includes(requested));
  }
  if (!candidates.length) {
    throw new Error(requested ? `No manageable HearMeOut room matches ${selector}.` : 'No manageable HearMeOut room was found. Name the room explicitly.');
  }
  if (candidates.length > 1) {
    throw new Error(`More than one HearMeOut room matches. Name one of: ${candidates.slice(0, 6).map((room: any) => room.name || room.id).join(', ')}.`);
  }
  return { room: candidates[0], actor };
}

export async function changeRoomPersonaForBotAction(input: ServiceActor & {
  room?: string;
  control: 'join' | 'leave';
  bot: ServiceBotPersona;
}) {
  const { room } = await resolveManagedRoomForBotAction(input.room, input);
  const bot = input.bot;
  if (!bot?.ownerTenantId || !bot?.name) throw new Error('A valid StreamWeaver bot is required.');
  if (bot.canInvite === false) throw new Error(`${bot.name} is not shared for HearMeOut room use.`);
  const presenceId = `persona:${bot.ownerTenantId}`;
  if (input.control === 'join' && db.get(`rooms/${room.id}/banned`, presenceId)) {
    throw new Error(`${bot.name} is banned from this room.`);
  }
  const result = await callWorker('/persona', {
    method: 'POST',
    body: JSON.stringify({
      action: input.control,
      roomId: room.id,
      personaId: bot.ownerTenantId,
      displayName: bot.name,
      ownerTenantId: bot.ownerTenantId,
      ownerName: bot.ownerName || '',
      wakeNames: bot.wakeNames || [bot.name, ...(bot.aliases || [])],
      aliases: bot.aliases || [],
      interests: bot.interests || [],
      voice: bot.voice || '',
      livekitTtsDescriptor: bot.livekitTtsDescriptor || '',
      avatar: bot.avatar || '',
      idleAvatar: bot.idleAvatar || bot.avatar || '',
      talkingAvatar: bot.talkingAvatar || bot.idleAvatar || bot.avatar || '',
      serviceSession: input.control === 'join',
    }),
  });
  if (input.control === 'join') {
    db.set(`rooms/${room.id}/users`, presenceId, {
      id: presenceId,
      uid: presenceId,
      displayName: bot.name,
      photoURL: bot.idleAvatar || bot.avatar || '',
      bot: true,
      personaId: bot.ownerTenantId,
      lastSeen: Date.now(),
    }, { merge: true });
  } else {
    db.delete(`rooms/${room.id}/users`, presenceId);
  }
  return { success: true as const, control: input.control, room: { id: room.id, name: room.name || room.id }, bot, worker: result };
}

async function resolveVoiceChannel(guildId: string, selector: string) {
  const botToken = text(process.env.DISCORD_BOT_TOKEN, 5000);
  if (!botToken) throw new Error('Discord bot token is not configured.');
  const response = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/channels`, {
    headers: { Authorization: `Bot ${botToken}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Discord voice channels could not be read (${response.status}).`);
  const rows = await response.json().catch(() => []);
  const voice = (Array.isArray(rows) ? rows : []).filter((row: any) => row.type === 2 || row.type === 13);
  const needle = normalize(selector).replace(/^#/, '');
  const exact = voice.filter((row: any) => String(row.id) === needle || normalize(row.name) === needle);
  if (!exact.length) throw new Error(`Discord voice channel ${selector} was not found.`);
  if (exact.length > 1) throw new Error(`More than one Discord voice channel is named ${selector}. Use its channel ID.`);
  return { id: String(exact[0].id), name: String(exact[0].name), type: Number(exact[0].type) };
}

export async function readVoiceBridgeForBotAction(input: ServiceActor & { room?: string }) {
  const { room } = await resolveManagedRoomForBotAction(input.room, input);
  const config = readVoiceBridgeConfig(room);
  let worker: any = {};
  try {
    worker = await callWorker(`/voice-bridge?roomId=${encodeURIComponent(room.id)}`, { method: 'GET' });
  } catch (error) {
    worker = { running: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { success: true as const, room: { id: room.id, name: room.name || room.id }, config, worker };
}

export async function controlVoiceBridgeForBotAction(input: ServiceActor & {
  room?: string;
  control: 'start' | 'stop' | 'listen-only' | 'two-way' | 'profile';
  guildId?: string;
  voiceChannel?: string;
  audioProfile?: string;
}) {
  const { room, actor } = await resolveManagedRoomForBotAction(input.room, input);
  if (isActivityRoomId(room.id)) await ensureDiscordActivityRoom();
  const current = readVoiceBridgeConfig(room);
  const now = new Date().toISOString();

  if (input.control === 'start') {
    const guildId = text(input.guildId || current.guildId, 80);
    if (!guildId) throw new Error('A Discord guild ID is required to start the voice bridge.');
    const channel = await resolveVoiceChannel(guildId, text(input.voiceChannel || current.voiceChannelId, 120));
    const next = { ...current, enabled: true, guildId, voiceChannelId: channel.id, updatedBy: actor.uid, updatedAt: now };
    db.set('rooms', room.id, { voiceBridge: next }, { merge: true });
    try {
      const worker = await callWorker('/voice-bridge', {
        method: 'POST',
        body: JSON.stringify({ action: 'start', roomId: room.id, guildId, voiceChannelId: channel.id, audioProfile: current.audioProfile }),
      });
      await callWorker('/voice-bridge/gate', {
        method: 'POST',
        body: JSON.stringify({ roomId: room.id, roomVoiceOutboundEnabled: current.roomVoiceOutboundEnabled }),
      });
      return { success: true as const, control: input.control, room: { id: room.id, name: room.name || room.id }, channel, config: next, worker };
    } catch (error) {
      await callWorker('/voice-bridge', {
        method: 'POST',
        body: JSON.stringify({ action: 'stop', roomId: room.id }),
      }).catch(() => null);
      db.set('rooms', room.id, { voiceBridge: { ...next, enabled: false } }, { merge: true });
      throw error;
    }
  }

  if (input.control === 'stop') {
    const next = { ...current, enabled: false, updatedBy: actor.uid, updatedAt: now };
    db.set('rooms', room.id, { voiceBridge: next }, { merge: true });
    const worker = await callWorker('/voice-bridge', { method: 'POST', body: JSON.stringify({ action: 'stop', roomId: room.id }) });
    return { success: true as const, control: input.control, room: { id: room.id, name: room.name || room.id }, config: next, worker };
  }

  if (input.control === 'listen-only' || input.control === 'two-way') {
    const roomVoiceOutboundEnabled = input.control === 'two-way';
    const next = { ...current, roomVoiceOutboundEnabled, updatedBy: actor.uid, updatedAt: now };
    db.set('rooms', room.id, { voiceBridge: next }, { merge: true });
    const worker = current.enabled
      ? await callWorker('/voice-bridge/gate', { method: 'POST', body: JSON.stringify({ roomId: room.id, roomVoiceOutboundEnabled }) })
      : { running: false, roomVoiceOutboundEnabled };
    return { success: true as const, control: input.control, room: { id: room.id, name: room.name || room.id }, config: next, worker };
  }

  const profile = normalize(input.audioProfile);
  if (!['low-latency', 'balanced', 'resilient'].includes(profile)) throw new Error('Audio profile must be low-latency, balanced, or resilient.');
  const next = { ...current, audioProfile: profile as VoiceBridgeConfig['audioProfile'], updatedBy: actor.uid, updatedAt: now };
  db.set('rooms', room.id, { voiceBridge: next }, { merge: true });
  const worker = await callWorker('/voice-bridge/audio-profile', { method: 'POST', body: JSON.stringify({ roomId: room.id, audioProfile: profile }) });
  return { success: true as const, control: input.control, room: { id: room.id, name: room.name || room.id }, config: next, worker };
}
