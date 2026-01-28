import 'dotenv/config';
import tmi from 'tmi.js';
import { addSongToPlaylist, getRoomState } from '@/lib/bot-actions';

// --- Twitch Bot Configuration ---
// Ensure all necessary environment variables are present.
const twitchBotUsername = process.env.TWITCH_BOT_USERNAME;
const twitchBotOauthToken = process.env.TWITCH_BOT_OAUTH_TOKEN;
const twitchChannelName = process.env.TWITCH_CHANNEL_NAME;
const targetRoomId = process.env.TARGET_ROOM_ID;

if (!twitchBotUsername || !twitchBotOauthToken || !twitchChannelName || !targetRoomId) {
    console.error("Missing required environment variables for Twitch bot. Please check your .env file.");
    process.exit(1);
}

const opts = {
  identity: {
    username: twitchBotUsername,
    password: twitchBotOauthToken,
  },
  channels: [twitchChannelName],
};

// --- Bot Main Logic ---
const client = new tmi.client(opts);

client.on('message', onMessageHandler);
client.on('connected', onConnectedHandler);

client.connect().catch((err) => {
    console.error("Failed to connect to Twitch:", err);
    process.exit(1);
});

function onConnectedHandler(addr: any, port: any) {
  console.log(`* Connected to ${addr}:${port}`);
  console.log(`* Listening for !sr, !status, !np commands in #${twitchChannelName}`);
  console.log(`* Adding songs to room: ${targetRoomId}`);
}

async function onMessageHandler(target: string, context: tmi.ChatUserstate, msg: string, self: boolean) {
  if (self) { return; } // Ignore messages from the bot itself

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
    client.say(target, "🎵 HearMeOut Commands: !sr [song/URL] - Request a song | !np - Now playing | !status - Room status | !help - Show this message");
  }
}
