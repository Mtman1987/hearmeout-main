import { NextRequest, NextResponse } from 'next/server';
import { addSongToPlaylist, updateRoomPlayState, skipTrack } from '@/lib/bot-actions';
import { db } from '@/firebase/admin';
import { verify } from 'crypto';

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

// Helper function to verify Discord's request signature
function verifyDiscordRequest(body: string, signature: string, timestamp: string): boolean {
  try {
    const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
    if (!PUBLIC_KEY) {
      console.error('DISCORD_PUBLIC_KEY not set');
      return false;
    }

    const { createVerify } = require('crypto');
    const verifier = createVerify('sha256');
    verifier.update(timestamp + body);
    
    return verifier.verify(
      `-----BEGIN PUBLIC KEY-----\n${PUBLIC_KEY}\n-----END PUBLIC KEY-----`,
      signature,
      'hex'
    );
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

async function handlePlayPauseButton(body: any, token: string): Promise<void> {
  const targetRoomId = process.env.TARGET_ROOM_ID;
  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
  
  if (!targetRoomId || !clientId) {
    await sendFollowup(clientId!, token, '❌ Bot not configured.');
    return;
  }

  try {
    const roomRef = db.collection('rooms').doc(targetRoomId);
    const roomDoc = await roomRef.get();
    
    if (!roomDoc.exists) {
      await sendFollowup(clientId, token, '❌ Room not found.');
      return;
    }

    const roomData = roomDoc.data();
    const currentState = roomData?.isPlaying || false;
    
    await roomRef.update({ isPlaying: !currentState });
    const status = !currentState ? '▶️ Playing' : '⏸️ Paused';
    
    await sendFollowup(clientId, token, status);
  } catch (error) {
    console.error('Error handling play/pause:', error);
    await sendFollowup(clientId, token, '❌ Error updating playback state.');
  }
}

async function handleSkipButton(body: any, token: string): Promise<void> {
  const targetRoomId = process.env.TARGET_ROOM_ID;
  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
  
  if (!targetRoomId || !clientId) {
    await sendFollowup(clientId!, token, '❌ Bot not configured.');
    return;
  }

  try {
    const result = await skipTrack(targetRoomId);
    const message = result.success ? `✅ ${result.message}` : `❌ ${result.message}`;
    await sendFollowup(clientId, token, message);
  } catch (error) {
    console.error('Error handling skip:', error);
    await sendFollowup(clientId, token, '❌ Error skipping track.');
  }
}

async function sendFollowup(clientId: string, token: string, content: string): Promise<void> {
  const followupUrl = `https://discord.com/api/v10/webhooks/${clientId}/${token}`;
  
  try {
    await fetch(followupUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    console.error('Discord followup message failed:', err);
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-signature-ed25519') || '';
  const timestamp = req.headers.get('x-signature-timestamp') || '';
  
  // Verify Discord request signature
  if (!verifyDiscordRequest(rawBody, signature, timestamp)) {
    console.error('Invalid Discord signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const body = JSON.parse(rawBody);
  const { type, data, member, token } = body;

  // Handle Discord's mandatory PING command
  if (type === InteractionType.PING) {
    return NextResponse.json({ type: InteractionResponseType.PONG });
  }

  // Handle message component interactions (buttons)
  if (type === InteractionType.MESSAGE_COMPONENT) {
    const { custom_id } = data;

    // Settings button - show ephemeral controls
    if (custom_id.startsWith('room_settings:')) {
      const roomId = custom_id.split(':')[1];
      return NextResponse.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '🎵 **Personal Music Controls**\nThese controls are only visible to you!',
          flags: 64, // Ephemeral
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 1,
                  label: 'Request Song',
                  emoji: { name: '🎶' },
                  custom_id: `request_song:${roomId}`,
                },
                {
                  type: 2,
                  style: 3,
                  label: 'Join Queue',
                  emoji: { name: '🎤' },
                  custom_id: `join_queue:${roomId}`,
                },
                {
                  type: 2,
                  style: 2,
                  label: 'Mute',
                  emoji: { name: '🔇' },
                  custom_id: `mute_toggle:${roomId}`,
                },
              ]
            }
          ]
        },
      });
    }

    // Join queue button
    if (custom_id.startsWith('join_queue:')) {
      const roomId = custom_id.split(':')[1];
      const userId = member?.user?.id || body.user?.id;
      const username = member?.user?.global_name || member?.user?.username || body.user?.username || 'Discord User';
      
      if (!userId) {
        return NextResponse.json({
          type: InteractionResponseType.UPDATE_MESSAGE,
          data: {
            content: '❌ Unable to identify your user ID.',
            components: [],
          },
        });
      }

      // Defer response
      const deferResponse = NextResponse.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 }
      });

      // Add to queue asynchronously
      (async () => {
        try {
          const queueRef = db.collection('rooms').doc(roomId).collection('voiceQueue');
          await queueRef.doc(userId).set({
            userId,
            username,
            addedAt: new Date().toISOString(),
            platform: 'discord',
          });

          const queueSnapshot = await queueRef.orderBy('addedAt').get();
          const position = queueSnapshot.docs.findIndex(doc => doc.id === userId) + 1;

          const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
          const followupUrl = `https://discord.com/api/v10/webhooks/${clientId}/${token}`;
          
          await fetch(followupUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: `✅ You've been added to the voice chat queue!\n**Position:** #${position}\n\nThe streamer will send you an invite link when it's your turn!`,
            }),
          });
        } catch (error) {
          console.error('Error adding to queue:', error);
          const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
          const followupUrl = `https://discord.com/api/v10/webhooks/${clientId}/${token}`;
          
          await fetch(followupUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: '❌ Error joining queue.' }),
          });
        }
      })();

      return deferResponse;
    }

    // Close main embed button
    if (custom_id.startsWith('room_close:')) {
      return NextResponse.json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: {
          content: '❌ Room embed closed.',
          embeds: [],
          components: [],
        },
      });
    }

    // Request song button from settings
    if (custom_id.startsWith('request_song:')) {
      const roomId = custom_id.split(':')[1];
      return NextResponse.json({
        type: InteractionResponseType.MODAL,
        data: {
          custom_id: `request_song_modal:${roomId}`,
          title: 'Request a Song',
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: 'song_request_input',
                  label: 'Song Name or YouTube URL',
                  style: 1,
                  required: true,
                  placeholder: 'e.g., Lofi Hip Hop or youtube.com/watch?v=...',
                },
              ],
            },
          ],
        },
      });
    }

    // Mute toggle button
    if (custom_id.startsWith('mute_toggle:')) {
      return NextResponse.json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: {
          content: '🔇 **Muted**\nThe music is now muted for you. This doesn\'t affect others!\n\n_Note: To unmute, adjust your volume in the web app._',
          components: [],
        },
      });
    }

    // Legacy buttons (keeping for backwards compatibility)
    if (custom_id === 'request_song_modal_trigger') {
      return NextResponse.json({
        type: InteractionResponseType.MODAL,
        data: {
          custom_id: 'request_song_modal_submit',
          title: 'Request a Song',
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: 'song_request_input',
                  label: 'Song Name or YouTube URL',
                  style: 1,
                  required: true,
                  placeholder: 'e.g., Lofi Hip Hop or youtube.com/watch?v=...',
                },
              ],
            },
          ],
        },
      });
    }

    if (custom_id === 'music_play_pause_btn') {
      const deferResponse = NextResponse.json({
        type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
      });
      handlePlayPauseButton(body, token).catch(err => 
        console.error('Error in handlePlayPauseButton:', err)
      );
      return deferResponse;
    }

    if (custom_id === 'music_skip_btn') {
      const deferResponse = NextResponse.json({
        type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
      });
      handleSkipButton(body, token).catch(err => 
        console.error('Error in handleSkipButton:', err)
      );
      return deferResponse;
    }
  }

  // Handle modal submission (song request)
  if (type === InteractionType.MODAL_SUBMIT) {
    const { custom_id } = data;

    // New modal format with room ID
    if (custom_id.startsWith('request_song_modal:')) {
      const roomId = custom_id.split(':')[1];
      const songQuery = data.components[0].components[0].value;
      const requester = member?.user?.global_name || member?.user?.username || 'Discord User';
      const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
      
      if (!roomId || !clientId) {
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '❌ Bot not configured.', flags: 64 }
        });
      }

      const deferResponse = NextResponse.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 }
      });

      addSongToPlaylist(songQuery, roomId, `${requester} (Discord)`)
        .then(result => {
          const followupUrl = `https://discord.com/api/v10/webhooks/${clientId}/${token}`;
          fetch(followupUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: result.success ? `✅ ${result.message}` : `❌ ${result.message}`,
            }),
          }).catch(err => console.error('Discord followup failed:', err));
        })
        .catch(err => {
          console.error('Error in addSongToPlaylist:', err);
          const followupUrl = `https://discord.com/api/v10/webhooks/${clientId}/${token}`;
          fetch(followupUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: '❌ Failed to add song.' }),
          }).catch(e => console.error('Discord error followup failed:', e));
        });

      return deferResponse;
    }

    // Legacy modal format
    if (custom_id === 'request_song_modal_submit') {
      const songQuery = data.components[0].components[0].value;
      const requester = member?.user?.global_name || member?.user?.username || 'Discord User';
      
      const targetRoomId = process.env.TARGET_ROOM_ID;
      const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
      
      if (!targetRoomId || !clientId) {
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '❌ Bot not configured.', flags: 64 }
        });
      }

      const deferResponse = NextResponse.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 }
      });

      addSongToPlaylist(songQuery, targetRoomId, `${requester} (Discord)`)
        .then(result => {
          const followupUrl = `https://discord.com/api/v10/webhooks/${clientId}/${token}`;
          fetch(followupUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: result.success ? `✅ ${result.message}` : `❌ ${result.message}`,
            }),
          }).catch(err => console.error('Discord followup failed:', err));
        })
        .catch(err => {
          console.error('Error in addSongToPlaylist:', err);
          const followupUrl = `https://discord.com/api/v10/webhooks/${clientId}/${token}`;
          fetch(followupUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: '❌ Failed to add song.' }),
          }).catch(e => console.error('Discord error followup failed:', e));
        });

      return deferResponse;
    }
  }

  console.warn("Unhandled Discord interaction type:", type);
  return NextResponse.json({ error: 'Unhandled interaction type' }, { status: 400 });
}
