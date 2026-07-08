import { NextRequest, NextResponse } from 'next/server';
import { addSongToPlaylist, skipTrack } from '@/lib/bot-actions';
import { db, ensureDb } from '@/lib/db';
import { GLOBAL_WATCH_SESSION_ID, normalizeWatchSessionAlias } from '@/lib/watch-session';
import {
  buildWatchJoinMessage,
  controlWatchSession,
  getActivityUrl,
  getResolvedWatchSession,
  watchLaneComponents,
  watchControlComponents,
  watchVolumeComponents,
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

async function sendFollowup(clientId: string, token: string, content: string): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${clientId}/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).catch(console.error);
}

async function handlePlayPauseButton(body: any, token: string): Promise<void> {
  const targetRoomId = process.env.TARGET_ROOM_ID;
  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
  if (!targetRoomId || !clientId) { await sendFollowup(clientId!, token, '❌ Bot not configured.'); return; }

  try {
    const roomData = db.get('rooms', targetRoomId);
    if (!roomData) { await sendFollowup(clientId, token, '❌ Room not found.'); return; }
    const newState = !roomData.isPlaying;
    db.update('rooms', targetRoomId, { isPlaying: newState });
    await sendFollowup(clientId, token, newState ? '▶️ Playing' : '⏸️ Paused');
  } catch { await sendFollowup(clientId!, token, '❌ Error updating playback state.'); }
}

async function handleSkipButton(body: any, token: string): Promise<void> {
  const targetRoomId = process.env.TARGET_ROOM_ID;
  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
  if (!targetRoomId || !clientId) { await sendFollowup(clientId!, token, '❌ Bot not configured.'); return; }

  try {
    const result = await skipTrack(targetRoomId);
    await sendFollowup(clientId, token, result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
  } catch { await sendFollowup(clientId!, token, '❌ Error skipping track.'); }
}

function getRequestBaseUrl(request: NextRequest) {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const proto = forwardedProto || request.nextUrl.protocol.replace(':', '');
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host;
  return `${proto}://${host}`;
}

function discordMemberCanManageWatch(member: any) {
  const permissions = BigInt(String(member?.permissions || '0') || '0');
  const ADMINISTRATOR = BigInt(0x8);
  const MANAGE_MESSAGES = BigInt(0x2000);
  const MANAGE_GUILD = BigInt(0x20);
  return Boolean(permissions & ADMINISTRATOR || permissions & MANAGE_MESSAGES || permissions & MANAGE_GUILD);
}

function resolveToggleAction(action: string, sessionId: string) {
  if (action !== 'play-pause' && action !== 'mute-unmute') return action;
  const session = getResolvedWatchSession(sessionId);
  if (action === 'play-pause') return session.playback.status === 'playing' ? 'pause' : 'play';
  return session.playback.muted === true ? 'unmute' : 'mute';
}

async function buildWatchControlUpdate(request: NextRequest, action: string, sessionId = GLOBAL_WATCH_SESSION_ID, actor?: any, position?: number) {
  const resolvedSessionId = normalizeWatchSessionAlias(sessionId, GLOBAL_WATCH_SESSION_ID);
  const resolvedAction = resolveToggleAction(action, resolvedSessionId);
  const session = await controlWatchSession(resolvedSessionId, resolvedAction, position, undefined, {
    actorUserId: actor?.userId,
    guildId: actor?.guildId,
    channelId: actor?.channelId,
    isAdmin: Boolean(actor?.isAdmin),
    platform: 'discord',
  });
  const joinUrl = getActivityUrl(getRequestBaseUrl(request), resolvedSessionId);

  if (!session.current) {
    return {
      content: `Watch Party is empty. Join Activity: ${joinUrl}`,
      embeds: [],
      components: watchControlComponents(joinUrl, resolvedSessionId),
      allowed_mentions: { parse: [] },
    };
  }

  const status = session.playback.status === 'playing'
    ? 'now playing'
    : session.playback.status === 'paused'
      ? 'paused'
      : 'ready';
  return buildWatchJoinMessage(session.current.item.title, status, joinUrl, session.current.item, resolvedSessionId);
}

function buildEphemeralWatchControls(request: NextRequest, sessionId = GLOBAL_WATCH_SESSION_ID) {
  const resolvedSessionId = normalizeWatchSessionAlias(sessionId, GLOBAL_WATCH_SESSION_ID);
  const joinUrl = getActivityUrl(getRequestBaseUrl(request), resolvedSessionId);
  return {
    content: 'Your watch controls are private to you.',
    components: watchControlComponents(joinUrl, resolvedSessionId),
    flags: 64,
  };
}

function buildEphemeralLanePicker() {
  return {
    content: 'Choose which HearMeOut lane to control.',
    components: watchLaneComponents(),
    flags: 64,
  };
}

function buildEphemeralVolumeControls(sessionId = GLOBAL_WATCH_SESSION_ID) {
  const resolvedSessionId = normalizeWatchSessionAlias(sessionId, GLOBAL_WATCH_SESSION_ID);
  return {
    content: 'Volume controls update the shared HearMeOut session.',
    components: watchVolumeComponents(resolvedSessionId),
    flags: 64,
  };
}

function buildVolumeModal(sessionId = GLOBAL_WATCH_SESSION_ID) {
  const resolvedSessionId = normalizeWatchSessionAlias(sessionId, GLOBAL_WATCH_SESSION_ID);
  return {
    custom_id: `hmo_watch_volume_submit:${resolvedSessionId}`,
    title: 'Set HearMeOut Volume',
    components: [{
      type: 1,
      components: [{
        type: 4,
        custom_id: 'volume_value',
        label: 'Volume 0-100',
        style: 1,
        required: true,
        min_length: 1,
        max_length: 3,
        placeholder: '85',
      }],
    }],
  };
}

function readModalValue(data: any, customId: string) {
  for (const row of data?.components || []) {
    for (const component of row.components || []) {
      if (component.custom_id === customId) return component.value;
    }
  }
  return '';
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

    if (custom_id.startsWith('hmo_watch_control:')) {
      const parts = String(custom_id).split(':');
      const action = String(parts[1] || '').toLowerCase();
      const sessionId = normalizeWatchSessionAlias(parts[2], GLOBAL_WATCH_SESSION_ID);
      const allowedActions = new Set(['play', 'pause', 'play-pause', 'mute', 'unmute', 'mute-unmute', 'next', 'clear']);
      if (!allowedActions.has(action)) {
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'Unsupported watch control.', flags: 64 },
        });
      }

      try {
        const update = await buildWatchControlUpdate(req, action, sessionId, {
          userId: member?.user?.id || body.user?.id,
          guildId: guild_id,
          channelId: channel_id,
          isAdmin: discordMemberCanManageWatch(member),
        });
        return NextResponse.json({ type: InteractionResponseType.UPDATE_MESSAGE, data: update });
      } catch (error: any) {
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: error?.message || 'Unable to update watch controls.', flags: 64 },
        });
      }
    }

    if (custom_id.startsWith('hmo_watch_controls:')) {
      const parts = String(custom_id).split(':');
      const sessionId = normalizeWatchSessionAlias(parts[1], GLOBAL_WATCH_SESSION_ID);
      return NextResponse.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: buildEphemeralWatchControls(req, sessionId),
      });
    }

    if (custom_id.startsWith('hmo_watch_lane:')) {
      return NextResponse.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: buildEphemeralLanePicker(),
      });
    }

    if (custom_id.startsWith('hmo_watch_volume_modal:')) {
      const parts = String(custom_id).split(':');
      return NextResponse.json({
        type: InteractionResponseType.MODAL,
        data: buildVolumeModal(parts[1] || GLOBAL_WATCH_SESSION_ID),
      });
    }

    if (custom_id.startsWith('hmo_watch_volume:')) {
      const parts = String(custom_id).split(':');
      return NextResponse.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: buildEphemeralVolumeControls(parts[1] || GLOBAL_WATCH_SESSION_ID),
      });
    }

    if (custom_id.startsWith('room_settings:')) {
      const roomId = custom_id.split(':')[1];
      return NextResponse.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '🎵 **Personal Music Controls**\nThese controls are only visible to you!',
          flags: 64,
          components: [{ type: 1, components: [
            { type: 2, style: 1, label: 'Request Song', emoji: { name: '🎶' }, custom_id: `request_song:${roomId}` },
            { type: 2, style: 3, label: 'Join Queue', emoji: { name: '🎤' }, custom_id: `join_queue:${roomId}` },
            { type: 2, style: 2, label: 'Mute', emoji: { name: '🔇' }, custom_id: `mute_toggle:${roomId}` },
          ]}],
        },
      });
    }

    if (custom_id.startsWith('join_queue:')) {
      const roomId = custom_id.split(':')[1];
      const userId = member?.user?.id || body.user?.id;
      const username = member?.user?.global_name || member?.user?.username || body.user?.username || 'Discord User';
      if (!userId) {
        return NextResponse.json({ type: InteractionResponseType.UPDATE_MESSAGE, data: { content: '❌ Unable to identify your user ID.', components: [] } });
      }

      const deferResponse = NextResponse.json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: 64 } });

      (async () => {
        try {
          db.set(`rooms/${roomId}/voiceQueue`, userId, { userId, username, addedAt: new Date().toISOString(), platform: 'discord' });
          const queue = db.query(`rooms/${roomId}/voiceQueue`, undefined, { field: 'addedAt', dir: 'asc' });
          const position = queue.findIndex(d => d.id === userId) + 1;
          const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
          await sendFollowup(clientId!, token, `✅ You've been added to the voice chat queue!\n**Position:** #${position}\n\nThe streamer will send you an invite link when it's your turn!`);
        } catch { const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID; await sendFollowup(clientId!, token, '❌ Error joining queue.'); }
      })();

      return deferResponse;
    }

    if (custom_id.startsWith('room_close:')) {
      return NextResponse.json({ type: InteractionResponseType.UPDATE_MESSAGE, data: { content: '❌ Room embed closed.', embeds: [], components: [] } });
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

    if (custom_id.startsWith('mute_toggle:')) {
      return NextResponse.json({ type: InteractionResponseType.UPDATE_MESSAGE, data: { content: '🔇 **Muted**\nThe music is now muted for you.', components: [] } });
    }

    if (custom_id === 'request_song_modal_trigger') {
      return NextResponse.json({
        type: InteractionResponseType.MODAL,
        data: { custom_id: 'request_song_modal_submit', title: 'Request a Song', components: [{ type: 1, components: [{ type: 4, custom_id: 'song_request_input', label: 'Song Name or YouTube URL', style: 1, required: true, placeholder: 'e.g., Lofi Hip Hop or youtube.com/watch?v=...' }] }] },
      });
    }

    if (custom_id === 'music_play_pause_btn') {
      const deferResponse = NextResponse.json({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
      handlePlayPauseButton(body, token).catch(console.error);
      return deferResponse;
    }

    if (custom_id === 'music_skip_btn') {
      const deferResponse = NextResponse.json({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
      handleSkipButton(body, token).catch(console.error);
      return deferResponse;
    }
  }

  if (type === InteractionType.MODAL_SUBMIT) {
    const { custom_id } = data;
    if (String(custom_id || '').startsWith('hmo_watch_volume_submit:')) {
      const sessionId = normalizeWatchSessionAlias(String(custom_id).split(':').slice(1).join(':'), GLOBAL_WATCH_SESSION_ID);
      const rawVolume = readModalValue(data, 'volume_value');
      const volume = Math.max(0, Math.min(100, Math.round(Number(rawVolume))));
      if (!Number.isFinite(volume)) {
        return NextResponse.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'Volume must be a number from 0 to 100.', flags: 64 },
        });
      }
      const update = await buildWatchControlUpdate(req, 'volume', sessionId, {
        userId: member?.user?.id || body.user?.id,
        guildId: guild_id,
        channelId: channel_id,
        isAdmin: discordMemberCanManageWatch(member),
      }, volume);
      return NextResponse.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `Set volume to ${volume}%.`, components: update.components, flags: 64 },
      });
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
      return NextResponse.json({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: '❌ Bot not configured.', flags: 64 } });
    }

    const deferResponse = NextResponse.json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: 64 } });

    addSongToPlaylist(songQuery, roomId, `${requester} (Discord)`)
      .then(result => sendFollowup(clientId, token, result.success ? `✅ ${result.message}` : `❌ ${result.message}`))
      .catch(() => sendFollowup(clientId, token, '❌ Failed to add song.'));

    return deferResponse;
  }

  return NextResponse.json({ error: 'Unhandled interaction type' }, { status: 400 });
}
