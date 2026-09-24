import { NextRequest, NextResponse } from 'next/server';
import tmi from 'tmi.js';
import { handleMusicCommand } from '@/lib/music-command-service';
import {
  controlWatchSession,
  getResolvedWatchSession,
  handleWatchRequestCommand,
  parseWatchCommand,
  requestWatchItem,
  requestWatchMusicItem,
} from '@/lib/watch-request-service';
import {
  SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID,
  SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID,
  SPACEMOUNTAIN_LOUNGE_ROOM_ID,
  SPACEMOUNTAIN_LOUNGE_TWITCH_CHANNEL,
} from '@/lib/spacemountain-lounge';
import { db, ensureDb } from '@/lib/db';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Per-server bot connections — multi-tenant ready
// Key: serverId, Value: { client, channels, tokens }
interface BotInstance {
  client: tmi.Client;
  channels: Map<string, string>; // twitchChannel -> roomId
  tokens: ServerBotTokens;
  syncInterval?: ReturnType<typeof setInterval>;
}

interface ServerBotTokens {
  accessToken: string;
  refreshToken: string;
  username: string;
  userId?: string;
  serverId: string;
}

const botInstances = new Map<string, BotInstance>();
let isInitialized = false;

const DEFAULT_COMMAND_BOT_NAMES = [
  'athenabot87',
  'streamweaverbot',
  'streamweaver87',
  'hearmeout',
  'hearmeoutbot',
  'nightbot',
  'streamelements',
  'streamlabs',
  'moobot',
  'fossabot',
];

function getPublicBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.APP_URL ||
    'https://hearmeout-main.fly.dev'
  ).replace(/\/$/, '');
}

function getIgnoredCommandBotNames() {
  const configured = String(process.env.TWITCH_COMMAND_BOT_IGNORE_LIST || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_COMMAND_BOT_NAMES, ...configured]);
}

function isIgnoredCommandBot(context: tmi.ChatUserstate, botUsername?: string) {
  const ignored = getIgnoredCommandBotNames();
  if (botUsername) ignored.add(botUsername.toLowerCase());

  const username = String(context.username || '').trim().toLowerCase();
  const displayName = String(context['display-name'] || '').trim().toLowerCase();
  return Boolean(
    (username && ignored.has(username)) ||
    (displayName && ignored.has(displayName))
  );
}

function twitchActor(context: tmi.ChatUserstate, channelName: string) {
  return {
    userId: String(context['user-id'] || context.username || 'twitch'),
    username: String(context['display-name'] || context.username || 'Someone from Twitch'),
    isHost: context.badges?.broadcaster === '1' || String(context.username || '').toLowerCase() === channelName,
    isAdmin: Boolean(context.mod) || context.badges?.moderator === '1',
  };
}

function isSpaceMountainLoungeCommand(message: string) {
  return /^!(?:sr|song|wr|watch)(?:\s+|$)/i.test(message)
    || /^!(?:np|nowplaying|status|skip|next|play|pause|stop|mute|unmute)(?:\s*)$/i.test(message)
    || /^!volume\s+\d{1,3}\s*$/i.test(message)
    || /^!radio(?:\s+(?:on|off|status))?\s*$/i.test(message);
}

async function handleSpaceMountainLoungeCommand(params: {
  message: string;
  context: tmi.ChatUserstate;
  channelName: string;
  guildId: string;
  channelId: string;
}) {
  const command = params.message.trim();
  const lower = command.toLowerCase();
  const actor = twitchActor(params.context, params.channelName);
  const baseIdentity = {
    guildId: params.guildId,
    channelId: params.channelId,
    userId: actor.userId,
    username: actor.username,
  };
  const musicIdentity = { ...baseIdentity, sessionId: SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID };
  const movieIdentity = { ...baseIdentity, sessionId: SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID };

  const song = command.match(/^!(?:sr|song)(?:\s+(.+))?$/i);
  if (song) {
    const query = String(song[1] || '').trim();
    if (!query) return 'Usage: !sr <song name or YouTube URL>';
    const result = await requestWatchMusicItem({ ...musicIdentity, query, platform: 'twitch' });
    if ('error' in result) return result.result?.message || 'Song request failed.';
    const position = result.session.current?.requestId === result.request.requestId
      ? 'now playing'
      : `queue position ${result.session.queue.length}`;
    return `Queued in the 24-Hour Lounge: ${result.request.item.title} (${position}).`;
  }

  const watch = command.match(/^!(?:wr|watch)(?:\s+(.+))?$/i);
  if (watch) {
    const query = String(watch[1] || '').trim();
    if (!query) return 'Usage: !wr <movie, show, or video>';
    const result = await requestWatchItem({ ...movieIdentity, query });
    if ('error' in result) return 'No playable match found for that watch request.';
    const position = result.session.current?.requestId === result.request.requestId
      ? 'now playing'
      : `queue position ${result.session.queue.length}`;
    return `Queued in the 24-Hour Lounge: ${result.request.item.title} (${position}).`;
  }

  const session = getResolvedWatchSession(SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID);
  if (lower === '!np' || lower === '!nowplaying') {
    return session.current
      ? `${session.playback.status === 'playing' ? 'Playing' : 'Ready'}: "${session.current.item.title}"`
      : 'Nothing is playing in the 24-Hour Lounge.';
  }
  if (lower === '!status') {
    const status = session.playback.status === 'playing' ? 'Playing' : session.playback.status === 'paused' ? 'Paused' : 'Idle';
    return `24-Hour Lounge: ${status} | Current: ${session.current?.item.title || 'None'} | Queue: ${session.queue.length}`;
  }

  const radio = command.match(/^!radio(?:\s+(on|off|status))?\s*$/i);
  if (radio) {
    const action = String(radio[1] || 'status').toLowerCase();
    if (action === 'status') return `24-Hour Lounge auto-radio is ${session.autoRadio ? 'on' : 'off'}.`;
    const next = await controlWatchSession(
      SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID,
      'auto-radio',
      action === 'on' ? 1 : 0,
      undefined,
      { actorUserId: actor.userId, isHost: actor.isHost, isAdmin: actor.isAdmin, platform: 'twitch' },
    );
    return `24-Hour Lounge auto-radio is ${next.autoRadio ? 'on' : 'off'}.`;
  }

  let action = '';
  let value: number | undefined;
  if (lower === '!skip' || lower === '!next') action = 'next';
  else if (lower === '!play') action = 'play';
  else if (lower === '!pause' || lower === '!stop') action = 'pause';
  else if (lower === '!mute') action = 'mute';
  else if (lower === '!unmute') action = 'unmute';
  else {
    const volume = command.match(/^!volume\s+(\d{1,3})\s*$/i);
    if (volume) {
      action = 'volume';
      value = Math.max(0, Math.min(100, Number(volume[1])));
    }
  }

  if (!action) return null;
  const next = await controlWatchSession(
    SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID,
    action,
    value,
    undefined,
    { actorUserId: actor.userId, isHost: actor.isHost, isAdmin: actor.isAdmin, platform: 'twitch' },
  );
  if (action === 'volume') return `24-Hour Lounge volume set to ${value}%.`;
  if (action === 'next') return next.current ? `Skipped to: ${next.current.item.title}` : 'Skipped. The Lounge queue is empty.';
  return `${action === 'play' ? 'Playing' : action === 'pause' ? 'Paused' : action === 'mute' ? 'Muted' : 'Unmuted'}: ${next.current?.item.title || 'the Lounge player'}`;
}

// --- Token management (per-server) ---

function dbTokenKey(serverId: string) {
  return `twitch_bot_${serverId}`;
}

function loadTokensFromDB(serverId: string): ServerBotTokens | null {
  const data = db.get('config', dbTokenKey(serverId));
  if (!data?.accessToken) return null;
  return { ...data, serverId };
}

function saveTokensToDB(tokens: ServerBotTokens) {
  db.set('config', dbTokenKey(tokens.serverId), {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    username: tokens.username,
    userId: tokens.userId || '',
    serverId: tokens.serverId,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Load tokens from DSH's local-db-export.
 * DSH is the auth authority — tokens are stored per-server.
 * Path: DiscordStreamHub/local-db-export/servers/{serverId}/config/twitchBotOAuth.json
 */
function loadTokensFromDSH(serverId: string): ServerBotTokens | null {
  const searchPaths = [
    join(process.cwd(), '..', 'DiscordStreamHub', 'local-db-export', 'servers', serverId, 'config', 'twitchBotOAuth.json'),
    join(process.cwd(), '..', 'DiscordStreamHub', 'data', 'servers', serverId, 'config', 'twitchBotOAuth.json'),
  ];

  for (const p of searchPaths) {
    try {
      if (!existsSync(p)) continue;
      const raw = JSON.parse(readFileSync(p, 'utf8'));
      if (!raw.accessToken) continue;
      console.log(`[Twitch Bot] Loaded DSH tokens from ${p} (user: ${raw.botUsername})`);
      return {
        accessToken: raw.accessToken,
        refreshToken: raw.refreshToken || '',
        username: raw.botUsername || '',
        userId: raw.botUserId || '',
        serverId,
      };
    } catch { /* skip */ }
  }
  return null;
}

function loadTokensFromSeedFile(serverId: string): ServerBotTokens | null {
  const seedPath = join(process.cwd(), 'data', `twitch-bot-seed-${serverId}.json`);
  try {
    if (!existsSync(seedPath)) return null;
    const raw = JSON.parse(readFileSync(seedPath, 'utf8'));
    if (!raw.accessToken) return null;
    console.log(`[Twitch Bot] Loaded seed file for: ${raw.username}`);
    return {
      accessToken: raw.accessToken,
      refreshToken: raw.refreshToken || '',
      username: raw.username || '',
      userId: raw.userId || '',
      serverId,
    };
  } catch { return null; }
}

function resolveTokens(serverId: string): ServerBotTokens | null {
  // 1. HMO's own DB (previously cached from DSH or OAuth callback)
  let tokens = loadTokensFromDB(serverId);
  if (tokens) return tokens;

  // 2. Seed file (from seed-twitch-token.js)
  tokens = loadTokensFromSeedFile(serverId);
  if (tokens) {
    saveTokensToDB(tokens);
    console.log(`[Twitch Bot] Loaded seed file into DB for server ${serverId}`);
    return tokens;
  }

  // 3. DSH export files (DSH = auth authority)
  tokens = loadTokensFromDSH(serverId);
  if (tokens) {
    saveTokensToDB(tokens);
    console.log(`[Twitch Bot] Cached DSH tokens into HMO DB for server ${serverId}`);
    return tokens;
  }

  // 4. Env vars as last resort (single-server dev fallback)
  if (process.env.TWITCH_BOT_OAUTH_TOKEN) {
    tokens = {
      accessToken: process.env.TWITCH_BOT_OAUTH_TOKEN,
      refreshToken: process.env.TWITCH_BOT_REFRESH_TOKEN || '',
      username: process.env.TWITCH_BOT_USERNAME || process.env.TWITCH_BROADCASTER_USERNAME || '',
      serverId,
    };
    saveTokensToDB(tokens);
    console.log('[Twitch Bot] Using env var tokens (dev fallback)');
    return tokens;
  }

  return null;
}

async function refreshBotToken(tokens: ServerBotTokens): Promise<boolean> {
  if (!tokens.refreshToken) return false;

  try {
    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || '',
        client_secret: process.env.TWITCH_CLIENT_SECRET || '',
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }),
    });

    if (!res.ok) {
      console.error(`[Twitch Bot] Refresh failed for server ${tokens.serverId}:`, res.status);
      return false;
    }

    const data = await res.json();
    tokens.accessToken = data.access_token;
    if (data.refresh_token) tokens.refreshToken = data.refresh_token;
    saveTokensToDB(tokens);
    console.log(`[Twitch Bot] Token refreshed for ${tokens.username} (server ${tokens.serverId})`);
    return true;
  } catch (e) {
    console.error('[Twitch Bot] Token refresh error:', e);
    return false;
  }
}

async function validateAndRefresh(tokens: ServerBotTokens): Promise<boolean> {
  try {
    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${tokens.accessToken}` },
    });
    if (res.ok) {
      const info = await res.json();
      console.log(`[Twitch Bot] Token valid: ${info.login} (expires ${info.expires_in}s)`);
      if (info.login) tokens.username = info.login;
      return true;
    }
  } catch { /* fall through to refresh */ }

  console.log(`[Twitch Bot] Token invalid for ${tokens.username}, attempting refresh...`);
  return refreshBotToken(tokens);
}

// --- Channel sync (per-server bot instance) ---

function syncChannels(serverId: string, instance: BotInstance) {
  const { client, channels: activeChannels, tokens } = instance;

  try {
    const rooms = db.list('rooms');
    const newChannels = new Map<string, string>();

    const primaryRoomId = rooms[0]?.id;

    // Keep the existing primary creator channel behavior unchanged.
    if (primaryRoomId) newChannels.set('mtman1987', primaryRoomId);

    // SpaceMountainLive is the permanent 24/7 Lounge command channel. Route it
    // directly to the system Lounge room so !sr/!wr cannot fall through to a
    // normal tenant/global media session.
    newChannels.set(SPACEMOUNTAIN_LOUNGE_TWITCH_CHANNEL, SPACEMOUNTAIN_LOUNGE_ROOM_ID);

    // Join the bot user's own channel if different
    if (primaryRoomId && tokens.username && tokens.username.toLowerCase() !== 'mtman1987') {
      newChannels.set(tokens.username.toLowerCase(), primaryRoomId);
    }

    // Also join channels from room user settings
    for (const room of rooms) {
      const users = db.list(`rooms/${room.id}/users`);
      for (const user of users) {
        if (user.data.twitchChannel) {
          newChannels.set(user.data.twitchChannel.toLowerCase(), room.id);
        }
      }
    }

    // Part channels we no longer need
    for (const [ch] of activeChannels) {
      if (!newChannels.has(ch)) {
        client.part(ch).catch(e => console.error(`Failed to leave ${ch}:`, e));
      }
    }

    // Join new channels
    for (const [ch, roomId] of newChannels) {
      if (!activeChannels.has(ch)) {
        client.join(ch).catch(e => console.error(`Failed to join ${ch}:`, e));
        console.log(`[Twitch Bot] Joined #${ch} -> room ${roomId}`);
      }
    }

    activeChannels.clear();
    newChannels.forEach((roomId, ch) => activeChannels.set(ch, roomId));
  } catch (error) {
    console.error('[Twitch Bot] syncChannels error:', error);
  }
}

// --- Message handler ---

function createMessageHandler(instance: BotInstance) {
  return async function onMessage(target: string, context: tmi.ChatUserstate, msg: string, self: boolean) {
    if (self || !instance.client) return;

    const channelName = target.replace('#', '').toLowerCase();
    const targetRoomId = instance.channels.get(channelName);
    if (!targetRoomId) return;

    const message = msg.trim().toLowerCase();
    const requester = context['display-name'] || 'Someone from Twitch';
    const client = instance.client;
    const watchCommand = parseWatchCommand(msg);
    const isCommand = message.startsWith('!');

    if (isCommand && isIgnoredCommandBot(context, instance.tokens.username)) {
      console.log(`[Twitch Bot] Ignoring bot-authored command from ${context.username || requester}: ${msg.trim()}`);
      return;
    }

    if (channelName === SPACEMOUNTAIN_LOUNGE_TWITCH_CHANNEL && isSpaceMountainLoungeCommand(msg.trim())) {
      try {
        const text = await handleSpaceMountainLoungeCommand({
          message: msg,
          context,
          channelName,
          guildId: instance.tokens.serverId || 'local',
          channelId: process.env.DISCORD_CHANNEL_ID || `twitch-${channelName}`,
        });
        if (text) await client.say(target, `@${requester} ${text}`);
      } catch (error) {
        console.error('[Twitch Bot] Live HMO Lounge request failed:', error);
        await client.say(target, `@${requester} The 24-Hour Lounge could not accept that request yet.`);
      }
      return;
    }

    if (watchCommand) {
      handleWatchRequestCommand({
        message: msg,
        discordUserId: context.username || context['user-id'] || 'twitch',
        discordUserName: `${requester} (Twitch)`,
        roomId: targetRoomId,
        guildId: instance.tokens.serverId || 'local',
        channelId: process.env.DISCORD_CHANNEL_ID || 'watch',
        publicBaseUrl: getPublicBaseUrl(),
        reply: (content) => {
          client.say(target, `@${requester} ${content}`);
        },
      }).catch((error) => {
        console.error('[Twitch Bot] watch request failed:', error);
        client.say(target, `❌ @${requester} Watch request failed.`);
      });
      return;
    }

    if (message.startsWith('!sr') || message === '!np' || message === '!nowplaying' || message === '!status' || message === '!skip' || message === '!next' || message === '!play' || message === '!pause' || message === '!stop' || message === '!mute' || message === '!unmute' || message.startsWith('!volume ')) {
      handleMusicCommand({
        message: msg,
        userId: context.username || context['user-id'] || 'twitch',
        username: String(requester),
        platform: 'twitch',
        roomId: targetRoomId,
        guildId: instance.tokens.serverId || 'local',
        channelId: process.env.DISCORD_CHANNEL_ID || `twitch-${channelName}`,
        publicBaseUrl: getPublicBaseUrl(),
        isHost: context.badges?.broadcaster === '1' || String(context.username || '').toLowerCase() === channelName,
        isAdmin: Boolean(context.mod) || context.badges?.moderator === '1',
        reply: (content) => {
          client.say(target, `@${requester} ${content}`);
        },
      }).catch((error) => {
        console.error('[Twitch Bot] music command failed:', error);
        client.say(target, `@${requester} Music command failed.`);
      });
    }

    if (message === '!help' || message === '!commands') {
      client.say(target, "🎵 Commands: !sr [song/URL] | !wr [movie/show] | !play | !pause | !skip | !np | !volume 0-100 | !mute | !unmute");
    }
  };
}

// --- Bot lifecycle ---

function attachBotHandlers(instance: BotInstance, serverId: string) {
  const { client, tokens } = instance;
  client.on('message', createMessageHandler(instance));
  client.on('connected', () => {
    console.log(`[Twitch Bot] Connected as ${tokens.username} for server ${serverId}`);
    if (instance.syncInterval) clearInterval(instance.syncInterval);
    syncChannels(serverId, instance);
    instance.syncInterval = setInterval(() => syncChannels(serverId, instance), 30000);
  });

  client.on('notice', async (_channel, msgid, message) => {
    if (msgid === 'msg_banned' || message.includes('authentication failed')) {
      console.log(`[Twitch Bot] Auth failed for ${tokens.username}, refreshing...`);
      const refreshed = await refreshBotToken(tokens);
      if (refreshed) {
        if (instance.syncInterval) clearInterval(instance.syncInterval);
        try { instance.client.disconnect(); } catch {}
        instance.client = new tmi.client({
          identity: { username: tokens.username, password: `oauth:${tokens.accessToken}` },
          channels: [],
        });
        attachBotHandlers(instance, serverId);
        instance.client.connect();
      }
    }
  });
}

async function startBotForServer(serverId: string): Promise<boolean> {
  if (botInstances.has(serverId)) return true;

  const tokens = resolveTokens(serverId);
  if (!tokens) {
    console.error(`[Twitch Bot] No tokens for server ${serverId}. Authorize via DSH settings.`);
    return false;
  }

  const valid = await validateAndRefresh(tokens);
  if (!valid) {
    console.error(`[Twitch Bot] Token invalid/unrefreshable for server ${serverId}`);
    return false;
  }

  const channels = new Map<string, string>();
  const client = new tmi.client({
    identity: {
      username: tokens.username,
      password: `oauth:${tokens.accessToken}`,
    },
    channels: [],
  });

  const instance: BotInstance = { client, channels, tokens };
  attachBotHandlers(instance, serverId);

  try {
    await instance.client.connect();
    botInstances.set(serverId, instance);
    return true;
  } catch (e) {
    console.error(`[Twitch Bot] Connect failed for server ${serverId}:`, e);
    return false;
  }
}

async function initializeAllBots() {
  if (isInitialized) return;
  await ensureDb();
  const serverIds = new Set<string>();
  const envServer = process.env.HARDCODED_GUILD_ID || process.env.NEXT_PUBLIC_HARDCODED_GUILD_ID || '';
  if (envServer) serverIds.add(envServer);

  const configDocs = db.list('config');
  for (const doc of configDocs) {
    if (doc.id.startsWith('twitch_bot_')) {
      serverIds.add(doc.id.replace('twitch_bot_', ''));
    }
  }

  // Also discover from room user settings
  const rooms = db.list('rooms');
  for (const room of rooms) {
    const users = db.list(`rooms/${room.id}/users`);
    for (const user of users) {
      const gid = String(user.data?.discordGuildId || '').trim();
      if (gid) serverIds.add(gid);
    }
  }

  for (const sid of serverIds) {
    if (!sid) continue;
    await startBotForServer(sid);
  }

  isInitialized = true;
}

// --- API handlers ---

export async function GET() {
  if (!isInitialized) await initializeAllBots();

  const instances: Record<string, any> = {};
  for (const [serverId, inst] of botInstances) {
    let tokenStatus = 'unknown';
    try {
      const v = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { 'Authorization': `OAuth ${inst.tokens.accessToken}` },
      });
      if (v.ok) {
        const info = await v.json();
        tokenStatus = `valid (${info.login}, expires ${info.expires_in}s)`;
      } else {
        tokenStatus = `invalid (${v.status})`;
      }
    } catch { tokenStatus = 'validation failed'; }

    instances[serverId] = {
      connected: inst.client.readyState() === 'OPEN',
      username: inst.tokens.username,
      tokenStatus,
      channels: Object.fromEntries(inst.channels),
    };
  }

  return NextResponse.json({
    status: isInitialized ? 'running' : 'not initialized',
    serverCount: botInstances.size,
    instances,
  });
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const defaultServerId = [...botInstances.keys()][0] || process.env.HARDCODED_GUILD_ID || process.env.NEXT_PUBLIC_HARDCODED_GUILD_ID || '';
  const serverId = searchParams.get('serverId') || defaultServerId;
  if (!serverId) return NextResponse.json({ error: 'Missing serverId' }, { status: 400 });

  if (action === 'test') {
    if (!isInitialized) await initializeAllBots();
    const inst = botInstances.get(serverId);
    if (!inst) return NextResponse.json({ error: `No bot for server ${serverId}` }, { status: 500 });
    if (inst.client.readyState() !== 'OPEN') return NextResponse.json({ error: 'Not connected' }, { status: 500 });

    const channel = searchParams.get('channel') || inst.tokens.username;
    try {
      if (!inst.channels.has(channel.toLowerCase())) await inst.client.join(channel);
      await inst.client.say(channel, `🤖 HearMeOut bot check — alive! (${new Date().toLocaleTimeString()})`);
      return NextResponse.json({ success: true, channel, channels: Object.fromEntries(inst.channels) });
    } catch (e: any) {
      return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
    }
  }

  if (action === 'refresh') {
    const inst = botInstances.get(serverId);
    if (!inst) return NextResponse.json({ error: 'No bot instance' }, { status: 500 });
    const ok = await refreshBotToken(inst.tokens);
    return NextResponse.json({ success: ok });
  }

  if (action === 'restart') {
    const inst = botInstances.get(serverId);
    if (inst) {
      if (inst.syncInterval) clearInterval(inst.syncInterval);
      try { inst.client.disconnect(); } catch {}
    }
    botInstances.delete(serverId);
    const ok = await startBotForServer(serverId);
    return NextResponse.json({ success: ok, status: ok ? 'restarted' : 'failed' });
  }

  return NextResponse.json({ error: 'Use ?action=test|refresh|restart[&serverId=xxx][&channel=xxx]' }, { status: 400 });
}
