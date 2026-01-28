import { NextRequest, NextResponse } from 'next/server';
import { addSongToPlaylist, updateRoomPlayState, skipTrack } from '@/lib/bot-actions';
import { db } from '@/firebase/admin';

// Discord Interaction Types
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
};

// Discord Interaction Response Types
const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  MODAL: 9,
};

// Helper function to verify Discord's request signature (HIGHLY RECOMMENDED FOR PRODUCTION)
function verifyDiscordRequest(body: string, signature: string, timestamp: string): boolean {
  // For production, implement proper signature verification:
  // https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
  
  // For now, return true - but you MUST implement this for security
  console.warn("⚠️ Discord signature verification is NOT implemented. This should be enabled in production.");
  return true;
}

async function handlePlayPauseButton(body: any): Promise<NextResponse> {
  const targetRoomId = process.env.TARGET_ROOM_ID;
  if (!targetRoomId) {
    return NextResponse.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '❌ Bot not configured (missing Room ID).',
        flags: 64
      }
    });
  }

  try {
    const roomRef = db.collection('rooms').doc(targetRoomId);
    const roomDoc = await roomRef.get();
    
    if (!roomDoc.exists) {
      return NextResponse.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Room not found.',
          flags: 64
        }
      });
    }

    const roomData = roomDoc.data();
    const currentState = roomData?.isPlaying || false;
    
    // Toggle play/pause
    await roomRef.update({ isPlaying: !currentState });

    const status = !currentState ? '▶️ Playing' : '⏸️ Paused';
    
    return NextResponse.json({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        content: `${status}`,
        flags: 64
      }
    });
  } catch (error) {
    console.error("Error handling play/pause:", error);
    return NextResponse.json({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        content: '❌ Error updating playback state.',
        flags: 64
      }
    });
  }
}

async function handleSkipButton(body: any): Promise<NextResponse> {
  const targetRoomId = process.env.TARGET_ROOM_ID;
  if (!targetRoomId) {
    return NextResponse.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '❌ Bot not configured (missing Room ID).',
        flags: 64
      }
    });
  }

  try {
    const result = await skipTrack(targetRoomId);
    
    return NextResponse.json({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        content: result.success ? `✅ ${result.message}` : `❌ ${result.message}`,
        flags: 64
      }
    });
  } catch (error) {
    console.error("Error handling skip:", error);
    return NextResponse.json({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        content: '❌ Error skipping track.',
        flags: 64
      }
    });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Verify Discord request signature
  const signature = req.headers.get('x-signature-ed25519') || '';
  const timestamp = req.headers.get('x-signature-timestamp') || '';
  const rawBody = await req.text();
  
  // Note: For production, properly verify the signature
  // verifyDiscordRequest(rawBody, signature, timestamp);

  const { type, data, member, token } = body;

  // Handle Discord's mandatory PING command
  if (type === InteractionType.PING) {
    return NextResponse.json({ type: InteractionResponseType.PONG });
  }

  // Handle message component interactions (buttons)
  if (type === InteractionType.MESSAGE_COMPONENT) {
    const { custom_id } = data;

    // Song request button
    if (custom_id === 'request_song_modal_trigger') {
      return NextResponse.json({
        type: InteractionResponseType.MODAL,
        data: {
          custom_id: 'request_song_modal_submit',
          title: 'Request a Song',
          components: [
            {
              type: 1, // Action Row
              components: [
                {
                  type: 4, // Text Input
                  custom_id: 'song_request_input',
                  label: 'Song Name or YouTube URL',
                  style: 1, // Short text
                  required: true,
                  placeholder: 'e.g., Lofi Hip Hop or youtube.com/watch?v=...',
                },
              ],
            },
          ],
        },
      });
    }

    // Play/Pause button
    if (custom_id === 'music_play_pause_btn') {
      return await handlePlayPauseButton(body);
    }

    // Skip button
    if (custom_id === 'music_skip_btn') {
      return await handleSkipButton(body);
    }
  }

  // Handle modal submission (song request)
  if (type === InteractionType.MODAL_SUBMIT) {
    const { custom_id } = data;

    if (custom_id === 'request_song_modal_submit') {
      const songQuery = data.components[0].components[0].value;
      const requester = member?.user?.global_name || member?.user?.username || 'Discord User';
      
      const targetRoomId = process.env.TARGET_ROOM_ID;
      if (!targetRoomId) {
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Sorry, the bot is not configured correctly on the server (missing Room ID).',
            flags: 64
          }
        });
      }

      // Acknowledge immediately
      const clientId = process.env.DISCORD_CLIENT_ID;
      if (!clientId) {
        console.error("DISCORD_CLIENT_ID is not set in .env");
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Bot configuration error.',
            flags: 64
          }
        });
      }

      // Process asynchronously
      addSongToPlaylist(songQuery, targetRoomId, `${requester} (Discord)`).then(result => {
        const followupUrl = `https://discord.com/api/v10/webhooks/${clientId}/${token}/messages/@original`;
        
        fetch(followupUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: result.success ? `✅ ${result.message}` : `❌ ${result.message}`,
          }),
        }).catch(err => console.error("Discord followup message failed:", err));
      }).catch(err => {
        console.error("Error in addSongToPlaylist:", err);
      });

      return NextResponse.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 }
      });
    }
  }

  console.warn("Unhandled Discord interaction type:", type);
  return NextResponse.json({ error: 'Unhandled interaction type' }, { status: 400 });
}
