import 'dotenv/config';
import tmi from 'tmi.js';
import { addSongToPlaylist, getRoomState } from '@/lib/bot-actions';
import { db } from '@/firebase/admin';

const twitchBotUsername = process.env.TWITCH_BOT_USERNAME;
const twitchBotOauthToken = process.env.TWITCH_BOT_OAUTH_TOKEN;

if (!twitchBotUsername || !twitchBotOauthToken) {
    console.error("Missing TWITCH_BOT_USERNAME or TWITCH_BOT_OAUTH_TOKEN");
    process.exit(1);
}

const client = new tmi.client({
  identity: {
    username: twitchBotUsername,
    password: twitchBotOauthToken,
  },
  channels: [],
});

const activeChannels = new Map<string, string>();

async function syncChannels() {
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
        console.log(`* Left channel: ${channel}`);
      }
    }

    for (const [channel, roomId] of newChannels) {
      if (!activeChannels.has(channel)) {
        client.join(channel).catch(e => console.error(`Failed to join ${channel}:`, e));
        console.log(`* Joined channel: ${channel} (room: ${roomId})`);
      }
    }

    activeChannels.clear();
    newChannels.forEach((roomId, channel) => activeChannels.set(channel, roomId));
  } catch (error) {
    console.error('Error syncing channels:', error);
  }
}

client.on('message', onMessageHandler);
client.on('connected', () => {
  console.log('* Connected to Twitch');
  syncChannels();
  setInterval(syncChannels, 30000);
});

client.connect().catch((err) => {
    console.error("Failed to connect to Twitch:", err);
    process.exit(1);
});

async function onMessageHandler(target: string, context: tmi.ChatUserstate, msg: string, self: boolean) {
  if (self) return;

  const channelName = target.replace('#', '').toLowerCase();
  const targetRoomId = activeChannels.get(channelName);
  
  if (!targetRoomId) return;

  const message = msg.trim().toLowerCase();
  const requester = context['display-name'] || 'Someone from Twitch';

  // --- !sr (Song Request) Command ---
  if (message.startsWith('!sr ')) {
    const songQuery = msg.substring(4).trim();
    
    if (!songQuery) {
      client.say(target, `@${requester}, usage: !sr [song name or YouTube URL]`);
      return;
    }
    
    console.log(`* Received !sr command from ${requester}: ${songQuery}`);

    try {
      const result = await addSongToPlaylist(songQuery, targetRoomId!, `${requester} (Twitch)`);
      
      if (result.success) {
        client.say(target, `✅ @${requester} ${result.message}`);
        console.log(`* Success: ${result.message}`);
      } else {
        client.say(target, `❌ @${requester} Sorry: ${result.message}`);
        console.error(`* Failed to add song: ${result.message}`);
      }
    } catch (error) {
      console.error("Error processing !sr command:", error);
      client.say(target, `❌ @${requester} A critical error occurred while adding the song.`);
    }
  }

  // --- !np (Now Playing) Command ---
  if (message === '!np') {
    try {
      const roomState = await getRoomState(targetRoomId!);
      
      if (!roomState) {
        client.say(target, "❌ Could not fetch room state.");
        return;
      }

      if (!roomState.currentTrack) {
        client.say(target, "🎵 No song is currently playing. Use !sr to request one!");
        return;
      }

      const status = roomState.isPlaying ? "▶️ Playing" : "⏸️ Paused";
      const track = roomState.currentTrack;
      client.say(target, `${status}: "${track.title}" by ${track.artist} (${roomState.playlistLength} songs in queue)`);
    } catch (error) {
      console.error("Error processing !np command:", error);
      client.say(target, "❌ Error fetching now playing info.");
    }
  }

  // --- !status Command ---
  if (message === '!status') {
    try {
      const roomState = await getRoomState(targetRoomId!);
      
      if (!roomState) {
        client.say(target, "❌ Could not fetch room state.");
        return;
      }

      const status = roomState.isPlaying ? "▶️ Playing" : "⏸️ Paused";
      client.say(target, `🎵 DJ: ${roomState.djDisplayName} | ${status} | Queue: ${roomState.playlistLength} songs`);
    } catch (error) {
      console.error("Error processing !status command:", error);
      client.say(target, "❌ Error fetching status.");
    }
  }

  // --- !help Command ---
  if (message === '!help' || message === '!commands') {
    client.say(target, "🎵 HearMeOut Commands: !sr [song/URL] - Request a song | !np - Now playing | !status - Room status | !queue - Join voice chat queue | !help - Show this message");
  }

  // --- !queue Command ---
  if (message === '!queue' || message === '!play') {
    try {
      const userId = context['user-id'];
      const username = context['display-name'] || context.username || 'Unknown';
      
      if (!userId) {
        client.say(target, `@${requester}, unable to identify your user ID.`);
        return;
      }

      // Add to queue in Firestore
      const queueRef = db.collection('rooms').doc(targetRoomId!).collection('voiceQueue');
      await queueRef.doc(userId).set({
        userId,
        username,
        addedAt: new Date().toISOString(),
        platform: 'twitch',
      });

      // Get queue position
      const queueSnapshot = await queueRef.orderBy('addedAt').get();
      const position = queueSnapshot.docs.findIndex(doc => doc.id === userId) + 1;

      client.say(target, `✅ @${requester} You've been added to the voice chat queue! Position: #${position}`);
      console.log(`* ${requester} joined voice queue (position ${position})`);
    } catch (error) {
      console.error('Error processing !queue command:', error);
      client.say(target, `❌ @${requester} Error joining queue.`);
    }
  }
}
