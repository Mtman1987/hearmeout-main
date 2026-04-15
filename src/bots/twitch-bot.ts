import tmi from 'tmi.js';
import { addSongToPlaylist, getRoomState } from '@/lib/bot-actions';
import { db, ensureDb } from '@/lib/db';
import { getUserBotToken, getUserBotUsername, refreshUserBotToken, getAllUsersWithTokens, validateToken } from '@/lib/token-service';

let client: tmi.Client | null = null;
let botUsername = '';
let currentToken = '';

async function initializeBot() {
  await ensureDb();
  
  const botData = db.get('config', 'twitch_bot') || { 
    access_token: process.env.TWITCH_BOT_OAUTH_TOKEN,
    refresh_token: process.env.TWITCH_BOT_REFRESH_TOKEN,
    username: process.env.TWITCH_BOT_USERNAME || 'Athenabot87'
  };

  if (!botData.access_token) {
    console.error('No bot token found in config or env.');
    process.exit(1);
  }

  botUsername = botData.username || 'Athenabot87';
  currentToken = botData.access_token;

  // Validate token before connecting — refresh if expired
  const isValid = await validateToken(currentToken);
  if (!isValid && botData.refresh_token) {
    console.log('[Twitch Bot] Token expired, refreshing...');
    const refreshed = await refreshUserBotToken('default', 'bot', botData.refresh_token);
    if (refreshed) {
      currentToken = refreshed;
      console.log('[Twitch Bot] Token refreshed successfully');
    } else {
      console.error('[Twitch Bot] Token refresh failed. Bot may not connect.');
    }
  } else if (!isValid) {
    console.error('[Twitch Bot] Token invalid and no refresh token available.');
  }

  console.log(`[Twitch Bot] Using bot: ${botUsername} (token valid: ${isValid || 'refreshed'})`);

  client = new tmi.client({
    identity: {
      username: botUsername,
      password: `oauth:${currentToken}`,
    },
    channels: [],
  });
}

const activeChannels = new Map<string, string>();

async function syncChannels() {
  try {
    await ensureDb();
    const rooms = db.list('rooms');
    const newChannels = new Map<string, string>();

    const broadcasterChannel = (process.env.TWITCH_BROADCASTER_USERNAME || 'mtman1987').toLowerCase();

    // Find or create a default room
    let defaultRoomId = 'default';
    if (rooms.length > 0) {
      defaultRoomId = rooms[0].id;
    } else {
      db.set('rooms', 'default', {
        name: 'Main Room',
        ownerId: process.env.HARDCODED_ADMIN_DISCORD_ID || 'admin',
        playlist: [],
        currentTrackId: '',
        isPlaying: false,
        djId: '',
        djDisplayName: '',
        createdAt: new Date().toISOString(),
      });
      console.log('[Twitch Bot] Auto-created default room');
    }

    newChannels.set(broadcasterChannel, defaultRoomId);

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
        client?.part(channel).catch((e: any) => console.error(`Failed to leave ${channel}:`, e));
      }
    }

    for (const [channel, roomId] of newChannels) {
      if (!activeChannels.has(channel)) {
        client?.join(channel).catch((e: any) => console.error(`Failed to join ${channel}:`, e));
        console.log(`[Twitch Bot] Joined channel: ${channel} (room: ${roomId})`);
      }
    }

    activeChannels.clear();
    newChannels.forEach((roomId, channel) => activeChannels.set(channel, roomId));
    console.log(`[Twitch Bot] Active channels:`, Object.fromEntries(activeChannels));
  } catch (error) {
    console.error('Error syncing channels:', error);
  }
}

await initializeBot();

client!.on('message', onMessageHandler);
client!.on('connected', () => {
  console.log('[Twitch Bot] Connected');
  syncChannels();
  setInterval(syncChannels, 30000);
});

client!.on('notice', async (channel: string, msgid: string, message: string) => {
  if (msgid === 'msg_banned' || message.includes('authentication failed')) {
    console.log('[Twitch Bot] Auth failed, trying refresh...');
    // Try refresh logic if needed
    if (db.get('config', 'twitch_bot')?.refresh_token) {
      const refreshed = await refreshUserBotToken('default', 'bot', db.get('config', 'twitch_bot').refresh_token);
      if (refreshed && client) {
        client.disconnect();
        currentToken = refreshed;
        client = new tmi.client({
          identity: {
            username: botUsername,
            password: `oauth:${refreshed}`,
          },
          channels: [],
        });
        client.connect();
      }
    }
  }
});

client!.connect().catch((err: any) => {
    console.error("[Twitch Bot] Failed to connect:", err);
    process.exit(1);
});

async function onMessageHandler(target: string, context: tmi.ChatUserstate, msg: string, self: boolean) {
  if (self || !client) return;

  const channelName = target.replace('#', '').toLowerCase();
  const targetRoomId = activeChannels.get(channelName);
  console.log(`[!sr DEBUG] Channel ${channelName} -> room ${targetRoomId || 'MISSING'} | msg: ${msg}`);
  
  if (!targetRoomId) {
    console.log(`[!sr DEBUG] No room for channel ${channelName}. Check user twitchChannel in rooms/${targetRoomId}/users`);
    return;
  }

  const message = msg.trim().toLowerCase();
  const requester = context['display-name'] || 'Someone from Twitch';

  if (message.startsWith('!sr ')) {
    const songQuery = msg.substring(4).trim();
    if (!songQuery) {
      client.say(target, `@${requester}, usage: !sr [song name or YouTube URL]`);
      return;
    }
    try {
    console.log(`[!sr DEBUG] Calling addSongToPlaylist(${songQuery}, ${targetRoomId})`);
    const result = await addSongToPlaylist(songQuery, targetRoomId, `${requester} (Twitch)`);
    console.log(`[!sr DEBUG] addSongToPlaylist result:`, result);
      client.say(target, result.success ? `✅ @${requester} ${result.message}` : `❌ @${requester} Sorry: ${result.message}`);
    } catch (error) {
      console.error("Error processing !sr command:", error);
      client.say(target, `❌ @${requester} A critical error occurred while adding the song.`);
    }
  }

  if (message === '!np') {
    try {
      const roomState = await getRoomState(targetRoomId);
      if (!roomState) { client.say(target, "❌ Could not fetch room state."); return; }
      if (!roomState.currentTrack) { client.say(target, "🎵 No song is currently playing. Use !sr to request one!"); return; }
      const status = roomState.isPlaying ? "▶️ Playing" : "⏸️ Paused";
      client.say(target, `${status}: "${roomState.currentTrack.title}" by ${roomState.currentTrack.artist} (${roomState.playlistLength} songs in queue)`);
    } catch (error) {
      client.say(target, "❌ Error fetching now playing info.");
    }
  }

  if (message === '!status') {
    try {
      const roomState = await getRoomState(targetRoomId);
      if (!roomState) { client.say(target, "❌ Could not fetch room state."); return; }
      const status = roomState.isPlaying ? "▶️ Playing" : "⏸️ Paused";
      client.say(target, `🎵 DJ: ${roomState.djDisplayName} | ${status} | Queue: ${roomState.playlistLength} songs`);
    } catch (error) {
      client.say(target, "❌ Error fetching status.");
    }
  }

  if (message === '!help' || message === '!commands') {
    client.say(target, "🎵 HearMeOut Commands: !sr [song/URL] - Request a song | !np - Now playing | !status - Room status | !queue - Join voice queue | !help - Show this");
  }

  if (message === '!queue' || message === '!play') {
    try {
      await ensureDb();
      const userId = context['user-id'];
      const username = context['display-name'] || context.username || 'Unknown';
      if (!userId) { client.say(target, `@${requester}, unable to identify your user ID.`); return; }

      db.set(`rooms/${targetRoomId}/voiceQueue`, userId, {
        userId, username, addedAt: new Date().toISOString(), platform: 'twitch',
      });

      const queue = db.list(`rooms/${targetRoomId}/voiceQueue`);
      const position = queue.findIndex(q => q.id === userId) + 1;
      client.say(target, `✅ @${requester} You've been added to the voice chat queue! Position: #${position}`);
    } catch (error) {
      console.error('Error processing !queue command:', error);
      client.say(target, `❌ @${requester} Error joining queue.`);
    }
  }
}
