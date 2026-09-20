import { buildWatchJoinMessage, controlWatchSession, extractWatchRoomAlias, getResolvedWatchSession, getWatchActivityJoinUrl, requestWatchMusicItem } from '@/lib/watch-request-service';
import { getMusicWatchSessionId } from '@/lib/watch-session';

export function parseMusicCommand(message: string) {
  const trimmed = message.trim();
  const requestMatch = trimmed.match(/^!(sr|song)(?:\s+(.+))?$/i);
  if (requestMatch) {
    const extracted = extractWatchRoomAlias((requestMatch[2] || '').trim(), getMusicWatchSessionId());
    return {
      command: `!${requestMatch[1].toLowerCase()}`,
      action: 'request' as const,
      query: extracted.query,
      sessionId: extracted.sessionId,
    };
  }

  if (/^!(np|nowplaying)$/i.test(trimmed)) return { command: '!np', action: 'nowPlaying' as const };
  if (/^!status$/i.test(trimmed)) return { command: '!status', action: 'status' as const };
  if (/^!(skip|next)$/i.test(trimmed)) return { command: '!skip', action: 'skip' as const };
  if (/^!play$/i.test(trimmed)) return { command: '!play', action: 'play' as const };
  if (/^!(pause|stop)$/i.test(trimmed)) return { command: '!pause', action: 'pause' as const };
  if (/^!mute$/i.test(trimmed)) return { command: '!mute', action: 'mute' as const };
  if (/^!unmute$/i.test(trimmed)) return { command: '!unmute', action: 'unmute' as const };
  const volumeMatch = trimmed.match(/^!volume\s+(\d{1,3})$/i);
  if (volumeMatch) return { command: '!volume', action: 'volume' as const, value: Math.max(0, Math.min(100, Number(volumeMatch[1]))) };
  return null;
}

export async function handleMusicCommand(params: {
  message: string;
  userId?: string;
  username: string;
  platform: 'discord' | 'twitch' | 'admin' | 'activity' | 'web';
  roomId?: string;
  guildId?: string;
  channelId?: string;
  activityVoiceChannelId?: string;
  publicBaseUrl?: string;
  isHost?: boolean;
  isAdmin?: boolean;
  // eslint-disable-next-line no-unused-vars
  reply?: (content: string) => void | Promise<void>;
  // eslint-disable-next-line no-unused-vars
  richReply?: (content: ReturnType<typeof buildWatchJoinMessage>) => void | Promise<void>;
}) {
  const parsed = parseMusicCommand(params.message);
  if (!parsed) return false;

  const parsedSessionId = 'sessionId' in parsed && parsed.sessionId ? parsed.sessionId : getMusicWatchSessionId();
  const sessionId = parsedSessionId === getMusicWatchSessionId()
    ? getMusicWatchSessionId()
    : parsedSessionId;
  const reply = params.reply || (() => undefined);

  if (parsed.action === 'request') {
    if (!parsed.query) {
      await reply(`Usage: ${parsed.command} <song name or YouTube URL>`);
      return true;
    }

    const result = await requestWatchMusicItem({
      sessionId,
      guildId: params.guildId,
      channelId: params.channelId,
      query: parsed.query,
      userId: params.userId || params.username,
      username: params.username,
      platform: params.platform,
    });
    if ('error' in result) {
      await reply(`Sorry: ${result.result.message}`);
      return true;
    }

    const position = result.session.current?.requestId === result.request.requestId
      ? 'now playing'
      : `queue position ${result.session.queue.length}`;
    const joinUrl = await getWatchActivityJoinUrl({
      publicBaseUrl: params.publicBaseUrl,
      sessionId,
      activityVoiceChannelId: params.activityVoiceChannelId,
      fallbackChannelId: params.channelId,
    });
    if (params.richReply) {
      await params.richReply(buildWatchJoinMessage(
        result.request.item.title,
        position,
        joinUrl,
        result.request.item,
        result.session.id,
      ));
    } else {
      await reply(`Queued in Music Videos: ${result.request.item.title} (${position}). Join: ${joinUrl}`);
    }
    return true;
  }

  if (parsed.action === 'nowPlaying') {
    const session = getResolvedWatchSession(sessionId);
    if (!session.current) {
      await reply('Nothing is playing. Use !sr <song> to request one.');
      return true;
    }
    const status = session.playback.status === 'playing' ? 'Playing' : 'Ready';
    await reply(`${status}: "${session.current.item.title}" from ${session.current.item.source}`);
    return true;
  }

  if (parsed.action === 'status') {
    const session = getResolvedWatchSession(sessionId);
    const status = session.playback.status === 'playing' ? 'Playing' : session.playback.status === 'paused' ? 'Paused' : 'Idle';
    await reply(`Watch Party: ${status} | Current: ${session.current?.item.title || 'None'} | Queue: ${session.queue.length}`);
    return true;
  }

  if (parsed.action === 'skip') {
    const session = await controlWatchSession(sessionId, 'next', undefined, undefined, {
      actorUserId: params.userId,
      guildId: params.guildId,
      channelId: params.channelId,
      platform: params.platform,
      isHost: params.isHost,
      isAdmin: params.isAdmin,
    });
    await reply(session.current ? `Skipped to: ${session.current.item.title}` : 'Skipped. Queue is now empty.');
    return true;
  }

  if (['play', 'pause', 'mute', 'unmute', 'volume'].includes(parsed.action)) {
    const value = parsed.action === 'volume' && 'value' in parsed ? parsed.value : undefined;
    const session = await controlWatchSession(sessionId, parsed.action, value, undefined, {
      actorUserId: params.userId,
      guildId: params.guildId,
      channelId: params.channelId,
      platform: params.platform,
      isHost: params.isHost,
      isAdmin: params.isAdmin,
    });
    const title = session.current?.item.title || 'the media player';
    const replyText = parsed.action === 'volume'
      ? `Volume set to ${value}% for ${title}.`
      : `${parsed.action === 'play' ? 'Playing' : parsed.action === 'pause' ? 'Paused' : parsed.action === 'mute' ? 'Muted' : 'Unmuted'}: ${title}`;
    await reply(replyText);
    return true;
  }

  return false;
}
