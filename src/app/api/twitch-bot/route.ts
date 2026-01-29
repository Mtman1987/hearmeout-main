import { NextRequest, NextResponse } from 'next/server';
import tmi from 'tmi.js';
import { addSongToPlaylist, getRoomState } from '@/lib/bot-actions';
import { db } from '@/firebase/admin';

let client: tmi.Client | null = null;
let isInitialized = false;
const activeChannels = new Map<string, string>();

async function syncChannels() {
  if (!client) return;
  
  try {
    const roomsSnapshot = await db.collection('rooms').get();
    const newChannels = new Map<string, string>();
    
    for (const roomDoc of roomsSnapshot.docs) {
      const usersSnapshot = await db.collection('rooms').doc(roomDoc.id).collection('users').get();
      usersSnapshot.forEach(userDoc => {
        const data = userDoc.data();
        if (data.twitchChannel) {
          newChannels.set(data.twitchChannel.toLowerCase(), roomDoc.id);
        }
      });
    }

    for (const [channel] of activeChannels) {
      if (!newChannels.has(channel)) {
        client.part(channel).catch(e => console.error(`Failed to leave ${channel}:`, e));
        console.log(`[Twitch Bot] Left channel: ${channel}`);
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

async function onMessageHandler(target: string, context: tmi.ChatUserstate, msg: string, self: boolean) {
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

    try {
      const result = await addSongToPlaylist(songQuery, targetRoomId, `${requester} (Twitch)`);
      
      if (result.success) {
        client.say(target, `✅ @${requester} ${result.message}`);
      } else {
        client.say(target, `❌ @${requester} Sorry: ${result.message}`);
      }
    } catch (error) {
      client.say(target, `❌ @${requester} A critical error occurred.`);
    }
  }

  if (message === '!np') {
    try {
      const roomState = await getRoomState(targetRoomId);
      
      if (!roomState?.currentTrack) {
        client.say(target, "🎵 No song is currently playing. Use !sr to request one!");
        return;
      }

      const status = roomState.isPlaying ? "▶️ Playing" : "⏸️ Paused";
      client.say(target, `${status}: "${roomState.currentTrack.title}" by ${roomState.currentTrack.artist}`);
    } catch (error) {
      client.say(target, "❌ Error fetching now playing info.");
    }
  }

  if (message === '!status') {
    try {
      const roomState = await getRoomState(targetRoomId);
      const status = roomState?.isPlaying ? "▶️ Playing" : "⏸️ Paused";
      client.say(target, `🎵 DJ: ${roomState?.djDisplayName || 'None'} | ${status} | Queue: ${roomState?.playlistLength || 0} songs`);
    } catch (error) {
      client.say(target, "❌ Error fetching status.");
    }
  }

  if (message === '!help' || message === '!commands') {
    client.say(target, "🎵 Commands: !sr [song/URL] | !np | !status | !help");
  }
}

function initializeTwitchBot() {
  if (isInitialized) return;

  const twitchBotUsername = process.env.TWITCH_BOT_USERNAME;
  const twitchBotOauthToken = process.env.TWITCH_BOT_OAUTH_TOKEN;

  console.log('[Twitch Bot] Checking credentials...');
  console.log('[Twitch Bot] Username exists:', !!twitchBotUsername);
  console.log('[Twitch Bot] OAuth token exists:', !!twitchBotOauthToken);

  if (!twitchBotUsername || !twitchBotOauthToken) {
    console.error('[Twitch Bot] Missing credentials');
    return;
  }

  client = new tmi.client({
    identity: {
      username: twitchBotUsername,
      password: twitchBotOauthToken,
    },
    channels: [],
  });

  client.on('message', onMessageHandler);
  client.on('connected', () => {
    console.log('[Twitch Bot] Connected');
    syncChannels();
    setInterval(syncChannels, 30000);
  });

  client.connect().catch(console.error);
  isInitialized = true;
}

export async function GET(req: NextRequest) {
  if (!isInitialized) {
    initializeTwitchBot();
  }

  return NextResponse.json({ 
    status: isInitialized ? 'running' : 'initializing',
    activeChannels: Array.from(activeChannels.keys())
  });
}
