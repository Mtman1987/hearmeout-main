import { NextRequest, NextResponse } from 'next/server';
import tmi from 'tmi.js';
import { addSongToPlaylist, getRoomState } from '@/lib/bot-actions';
import { db, ensureDb } from '@/lib/db';

let client: tmi.Client | null = null;
let isInitialized = false;
const activeChannels = new Map<string, string>();
let botTokens: { access_token: string; refresh_token: string; username: string } | null = null;

async function refreshToken() {
  if (!botTokens?.refresh_token) return null;

  try {
    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || '',
        client_secret: process.env.TWITCH_CLIENT_SECRET || '',
        grant_type: 'refresh_token',
        refresh_token: botTokens.refresh_token,
      }),
    });

    if (!res.ok) {
      console.error('[Twitch Bot] Refresh HTTP error:', res.status, await res.text().catch(() => ''));
      return null;
    }

    const tokens = await res.json();
    botTokens.access_token = tokens.access_token;
    if (tokens.refresh_token) botTokens.refresh_token = tokens.refresh_token;

    db.update('config', 'twitch_bot', {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || botTokens.refresh_token,
      updated_at: new Date().toISOString(),
    });

    console.log('[Twitch Bot] Token refreshed successfully');
    return `oauth:${tokens.access_token}`;
  } catch (e) {
    console.error('[Twitch Bot] Token refresh failed:', e);
    return null;
  }
}

function syncChannels() {
  if (!client) return;

  try {
    const rooms = db.list('rooms');
    const newChannels = new Map<string, string>();

    for (const room of rooms) {
      const users = db.list(`rooms/${room.id}/users`);
      for (const user of users) {
        if (user.data.twitchChannel) {
          newChannels.set(user.data.twitchChannel.toLowerCase(), room.id);
        }
      }
    }

    for (const [channel] of activeChannels) {
      if (!newChannels.has(channel)) {
        client.part(channel).catch(e => console.error(`Failed to leave ${channel}:`, e));
      }
    }

    for (const [channel, roomId] of newChannels) {
      if (!activeChannels.has(channel)) {
        client.join(channel).catch(e => console.error(`Failed to join ${channel}:`, e));
        console.log(`[Twitch Bot] Joined channel: ${channel} (room: ${roomId})`);
      }
    }

    activeChannels.clear();
    newChannels.forEach((roomId, channel) => activeChannels.set(channel, roomId));
  } catch (error) {
    console.error('[Twitch Bot] Error syncing channels:', error);
  }
}

function onMessageHandler(target: string, context: tmi.ChatUserstate, msg: string, self: boolean) {
  if (self || !client) return;

  const channelName = target.replace('#', '').toLowerCase();
  const targetRoomId = activeChannels.get(channelName);
  if (!targetRoomId) return;

  const message = msg.trim().toLowerCase();
  const requester = context['display-name'] || 'Someone from Twitch';

  if (message.startsWith('!sr ')) {
    const songQuery = msg.substring(4).trim();
    if (!songQuery) {
      client.say(target, `@${requester}, usage: !sr [song name or YouTube URL]`);
      return;
    }
    addSongToPlaylist(songQuery, targetRoomId, `${requester} (Twitch)`)
      .then(result => {
        client!.say(target, result.success ? `✅ @${requester} ${result.message}` : `❌ @${requester} Sorry: ${result.message}`);
      })
      .catch(() => {
        client!.say(target, `❌ @${requester} A critical error occurred.`);
      });
  }

  if (message === '!np') {
    getRoomState(targetRoomId).then(roomState => {
      if (!roomState?.currentTrack) {
        client!.say(target, "🎵 No song is currently playing. Use !sr to request one!");
        return;
      }
      const status = roomState.isPlaying ? "▶️ Playing" : "⏸️ Paused";
      client!.say(target, `${status}: "${roomState.currentTrack.title}" by ${roomState.currentTrack.artist}`);
    }).catch(() => {
      client!.say(target, "❌ Error fetching now playing info.");
    });
  }

  if (message === '!status') {
    getRoomState(targetRoomId).then(roomState => {
      const status = roomState?.isPlaying ? "▶️ Playing" : "⏸️ Paused";
      client!.say(target, `🎵 DJ: ${roomState?.djDisplayName || 'None'} | ${status} | Queue: ${roomState?.playlistLength || 0} songs`);
    }).catch(() => {
      client!.say(target, "❌ Error fetching status.");
    });
  }

  if (message === '!help' || message === '!commands') {
    client.say(target, "🎵 Commands: !sr [song/URL] | !np | !status | !help");
  }
}

async function initializeTwitchBot() {
  if (isInitialized) return;

  await ensureDb();

  // Load bot tokens from DB (moved from top-level to avoid race condition)
  if (!botTokens) {
    const twitchUsers = db.list('users').filter((u: any) => u.id.startsWith('twitch_'));
    if (twitchUsers.length > 0) botTokens = twitchUsers[0].data;
  }

  let botData = db.get('config', 'twitch_bot');
  if (!botData) {
    // Try fetching from DSH's shared database
    try {
      const DSH_URL = process.env.DSH_URL || 'https://discord-stream-hub-new.fly.dev';
      const serverId = process.env.HARDCODED_GUILD_ID || '1240832965865635881';
      const res = await fetch(`${DSH_URL}/api/db?path=users/twitch_${serverId}`);
      if (res.ok) {
        const dshData = await res.json();
        if (dshData.exists && dshData.data) {
          const d = dshData.data;
          botData = {
            access_token: d.accessToken || d.access_token,
            refresh_token: d.refreshToken || d.refresh_token || '',
            username: d.username || d.displayName || 'Athenabot87',
          };
          db.set('config', 'twitch_bot', botData);
          console.log('[Twitch Bot] Loaded tokens from DSH');
        }
      }
    } catch (e) {
      console.log('[Twitch Bot] Could not fetch from DSH');
    }
  }
  if (!botData) {
    try {
      const sharedPath = '/data/hearmeout-twitch-auth.json';
      const fs = await import('fs/promises');
      const data = await fs.readFile(sharedPath, 'utf8');
      const sharedTokens = JSON.parse(data);
      db.set('config', 'twitch_bot', sharedTokens);
      botData = sharedTokens;
    } catch (e) {
      console.log('[Twitch Bot] No shared tokens found');
    }
  }
  if (!botData && process.env.TWITCH_BOT_OAUTH_TOKEN) {
    botData = {
      access_token: process.env.TWITCH_BOT_OAUTH_TOKEN,
      refresh_token: '',
      username: process.env.TWITCH_BOT_USERNAME || 'Athenabot87',
    };
    db.set('config', 'twitch_bot', botData);
    console.log('[Twitch Bot] Using env var tokens');
  }
  if (!botData) {
    console.error('[Twitch Bot] No tokens in DB. Authorize bot in settings.');
    return;
  }

  botTokens = botData;
  console.log('[Twitch Bot] Loaded tokens for:', botTokens?.username);

  // Validate token before connecting — refresh if expired
  let tokenValid = false;
  try {
    const validateRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${botTokens!.access_token}` },
    });
    tokenValid = validateRes.ok;
    if (!tokenValid) console.log('[Twitch Bot] Token invalid (status:', validateRes.status, ')');
  } catch { console.log('[Twitch Bot] Token validation request failed'); }

  if (!tokenValid && botTokens!.refresh_token) {
    console.log('[Twitch Bot] Refreshing expired token...');
    const newToken = await refreshToken();
    if (newToken) {
      console.log('[Twitch Bot] Token refreshed, proceeding');
    } else {
      console.error('[Twitch Bot] Refresh failed — bot may not connect');
    }
  } else if (!tokenValid) {
    console.error('[Twitch Bot] Token invalid, no refresh token. Re-authorize in settings.');
    return;
  }

  client = new tmi.client({
    identity: {
      username: botTokens!.username,
      password: `oauth:${botTokens!.access_token}`,
    },
    channels: [],
  });

  client.on('message', onMessageHandler);
  client.on('connected', () => {
    console.log('[Twitch Bot] Connected');
    syncChannels();
    setInterval(syncChannels, 30000);
  });

  client.on('notice', async (channel, msgid, message) => {
    if (msgid === 'msg_banned' || message.includes('authentication failed')) {
      console.log('[Twitch Bot] Auth failed, refreshing token...');
      const newToken = await refreshToken();
      if (newToken && client) {
        client.disconnect();
        client = new tmi.client({
          identity: { username: botTokens!.username, password: newToken },
          channels: [],
        });
        client.connect();
      }
    }
  });

  await client.connect().catch(console.error);
  isInitialized = true;
}

export async function GET(req: NextRequest) {
  if (!isInitialized) {
    await initializeTwitchBot();
  }

  // Validate current token
  let tokenStatus = 'unknown';
  if (botTokens?.access_token) {
    try {
      const v = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { 'Authorization': `OAuth ${botTokens.access_token}` },
      });
      if (v.ok) {
        const info = await v.json();
        tokenStatus = `valid (${info.login}, expires in ${info.expires_in}s)`;
      } else {
        tokenStatus = `invalid (${v.status})`;
      }
    } catch (e) {
      tokenStatus = 'validation failed';
    }
  } else {
    tokenStatus = 'no token';
  }

  return NextResponse.json({
    status: isInitialized ? 'running' : 'not initialized',
    connected: client?.readyState() === 'OPEN',
    botUsername: botTokens?.username || 'none',
    tokenStatus,
    hasRefreshToken: !!botTokens?.refresh_token,
    activeChannels: Object.fromEntries(activeChannels),
    channelCount: activeChannels.size,
  });
}

// POST /api/twitch-bot?action=test&channel=mtman1987
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'test') {
    const channel = searchParams.get('channel') || 'mtman1987';

    if (!isInitialized) await initializeTwitchBot();
    if (!client) return NextResponse.json({ error: 'Bot not initialized' }, { status: 500 });

    const connected = client.readyState() === 'OPEN';
    if (!connected) return NextResponse.json({ error: 'Bot not connected to Twitch', readyState: client.readyState() }, { status: 500 });

    const inChannel = activeChannels.has(channel.toLowerCase());

    try {
      if (!inChannel) await client.join(channel);
      await client.say(channel, `🤖 HearMeOut bot check — I'm alive! (${new Date().toLocaleTimeString()})`);
      return NextResponse.json({
        success: true,
        message: `Test message sent to #${channel}`,
        wasInChannel: inChannel,
        activeChannels: Object.fromEntries(activeChannels),
      });
    } catch (e: any) {
      return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
    }
  }

  if (action === 'refresh') {
    const newToken = await refreshToken();
    return NextResponse.json({ success: !!newToken, refreshed: !!newToken });
  }

  if (action === 'restart') {
    if (client) { try { client.disconnect(); } catch {} }
    client = null;
    isInitialized = false;
    await initializeTwitchBot();
    return NextResponse.json({ success: isInitialized, status: isInitialized ? 'restarted' : 'failed' });
  }

  return NextResponse.json({ error: 'Unknown action. Use ?action=test&channel=xxx or ?action=refresh or ?action=restart' }, { status: 400 });
}
