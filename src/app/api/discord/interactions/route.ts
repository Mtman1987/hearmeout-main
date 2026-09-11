import { NextRequest, NextResponse } from 'next/server';
import { addSongToPlaylist } from '@/lib/bot-actions';
import { db, ensureDb } from '@/lib/db';
import {
  buildHearMeOutDiscordPayload,
  type HearMeOutDiscordPayload,
} from '@/lib/discord-messaging';
import {
  getActivityUrl,
  watchLaneComponents,
  watchControlComponents,
} from '@/lib/watch-request-service';
import nacl from 'tweetnacl';

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3, APPLICATION_COMMAND_AUTOCOMPLETE: 4, MODAL_SUBMIT: 5 };
const InteractionResponseType = { PONG: 1, CHANNEL_MESSAGE_WITH_SOURCE: 4, DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5, DEFERRED_UPDATE_MESSAGE: 6, UPDATE_MESSAGE: 7, MODAL: 9 };

function verifyDiscordRequest(body: string, signature: string, timestamp: string): boolean {
  try {
    const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
    if (!PUBLIC_KEY) return false;
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + body),
      Buffer.from(signature, 'hex'),
      Buffer.from(PUBLIC_KEY, 'hex')
    );
  } catch { return false; }
}

function interactionContext(body: any, responseType: string) {
  const user = body?.member?.user || body?.user || {};
  const avatar = user.id && user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${String(user.avatar).startsWith('a_') ? 'gif' : 'png'}?size=128`
    : undefined;
  return {
    responseType,
    sourceUser: user.global_name || user.username || 'Discord User',
    sourceMessage: body?.data?.name
      ? `/${body.data.name}`
      : String(body?.data?.custom_id || 'Discord interaction'),
    sourceUserAvatarUrl: avatar,
  };
}

async function interactionMessage(
  body: any,
  raw: string | HearMeOutDiscordPayload,
  responseType: string,
) {
  return buildHearMeOutDiscordPayload(raw, interactionContext(body, responseType));
}

async function sendFollowup(clientId: string, token: string, content: string, body?: any): Promise<void> {
  const payload = await interactionMessage(body, content, 'Interaction Update');
  await fetch(`https://discord.com/api/v10/webhooks/${clientId}/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(console.error);
}

function getRequestBaseUrl(request: NextRequest) {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const proto = forwardedProto || request.nextUrl.protocol.replace(':', '');
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host;
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-signature-ed25519') || '';
  const timestamp = req.headers.get('x-signature-timestamp') || '';

  if (!verifyDiscordRequest(rawBody, signature, timestamp)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  await ensureDb();

  const body = JSON.parse(rawBody);
  const { type, data, member, token, guild_id, channel_id } = body;

  if (type === InteractionType.PING) {
    return NextResponse.json({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.MESSAGE_COMPONENT) {
    const { custom_id } = data;
    if (/^(?:hmo_watch_controls?:|hmo_watch_volume|music_play_pause_btn|music_skip_btn|mute_toggle:)/.test(String(custom_id || ''))) {
      return NextResponse.json({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'Playback controls are temporarily unavailable. Adjust your own volume using the slider in the player.', flags: 64,
          components: watchControlComponents(getActivityUrl(getRequestBaseUrl(req))) } });
    }


    if (custom_id.startsWith('hmo_watch_lane:')) {
      return NextResponse.json({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'Open the shared player.', flags: 64, components: watchLaneComponents() } });
    }
    if (custom_id.startsWith('room_settings:')) {
      const roomId = custom_id.split(':')[1];
      return NextResponse.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: await interactionMessage(body, {
          content: 'Request music or join the voice queue. Adjust your own listening volume inside the player.', flags: 64,
          components: [{ type: 1, components: [
            { type: 2, style: 1, label: 'Request Song', custom_id: `request_song:${roomId}` },
            { type: 2, style: 3, label: 'Join Queue', custom_id: `join_queue:${roomId}` },
            { type: 2, style: 5, label: 'Open player', url: getActivityUrl(getRequestBaseUrl(req), 'discord-music-room') },
          ]}],
        }, 'Music'),
      });
    }

    if (custom_id.startsWith('join_queue:')) {
      const roomId = custom_id.split(':')[1];
      const userId = member?.user?.id || body.user?.id;
      const username = member?.user?.global_name || member?.user?.username || body.user?.username || 'Discord User';
      if (!userId) {
        return NextResponse.json({
          type: InteractionResponseType.UPDATE_MESSAGE,
          data: await interactionMessage(body, { content: '❌ Unable to identify your user ID.', components: [] }, 'Voice Queue'),
        });
      }

      const deferResponse = NextResponse.json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: 64 } });

      (async () => {
        try {
          db.set(`rooms/${roomId}/voiceQueue`, userId, { userId, username, addedAt: new Date().toISOString(), platform: 'discord' });
          const queue = db.query(`rooms/${roomId}/voiceQueue`, undefined, { field: 'addedAt', dir: 'asc' });
          const position = queue.findIndex(d => d.id === userId) + 1;
          const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
          await sendFollowup(clientId!, token, `✅ You've been added to the voice chat queue!\n**Position:** #${position}\n\nThe streamer will send you an invite link when it's your turn!`, body);
        } catch { const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID; await sendFollowup(clientId!, token, '❌ Error joining queue.', body); }
      })();

      return deferResponse;
    }

    if (custom_id.startsWith('room_close:')) {
      return NextResponse.json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: await interactionMessage(body, { content: '❌ Room embed closed.', embeds: [], components: [] }, 'Room Controls'),
      });
    }

    if (custom_id.startsWith('request_song:')) {
      const roomId = custom_id.split(':')[1];
      return NextResponse.json({
        type: InteractionResponseType.MODAL,
        data: {
          custom_id: `request_song_modal:${roomId}`,
          title: 'Request a Song',
          components: [{ type: 1, components: [{ type: 4, custom_id: 'song_request_input', label: 'Song Name or YouTube URL', style: 1, required: true, placeholder: 'e.g., Lofi Hip Hop or youtube.com/watch?v=...' }] }],
        },
      });
    }

    if (custom_id === 'request_song_modal_trigger') {
      return NextResponse.json({
        type: InteractionResponseType.MODAL,
        data: { custom_id: 'request_song_modal_submit', title: 'Request a Song', components: [{ type: 1, components: [{ type: 4, custom_id: 'song_request_input', label: 'Song Name or YouTube URL', style: 1, required: true, placeholder: 'e.g., Lofi Hip Hop or youtube.com/watch?v=...' }] }] },
      });
    }


  }

  if (type === InteractionType.MODAL_SUBMIT) {
    const { custom_id } = data;
    if (/^(?:hmo_watch_controls?:|hmo_watch_volume|music_play_pause_btn|music_skip_btn|mute_toggle:)/.test(String(custom_id || ''))) {
      return NextResponse.json({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'Playback controls are temporarily unavailable. Adjust your own volume using the slider in the player.', flags: 64,
          components: watchControlComponents(getActivityUrl(getRequestBaseUrl(req))) } });
    }

    const songQuery = data.components[0].components[0].value;
    const requester = member?.user?.global_name || member?.user?.username || 'Discord User';
    const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;

    let roomId: string | undefined;
    if (custom_id.startsWith('request_song_modal:')) {
      roomId = custom_id.split(':')[1];
    } else if (custom_id === 'request_song_modal_submit') {
      roomId = process.env.TARGET_ROOM_ID;
    }

    if (!roomId || !clientId) {
      return NextResponse.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: await interactionMessage(body, { content: '❌ Bot not configured.', flags: 64 }, 'Song Request'),
      });
    }

    const deferResponse = NextResponse.json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: 64 } });

    addSongToPlaylist(songQuery, roomId, `${requester} (Discord)`)
      .then(result => sendFollowup(clientId, token, result.success ? `✅ ${result.message}` : `❌ ${result.message}`, body))
      .catch(() => sendFollowup(clientId, token, '❌ Failed to add song.', body));

    return deferResponse;
  }

  return NextResponse.json({ error: 'Unhandled interaction type' }, { status: 400 });
}
