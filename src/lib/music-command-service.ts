import { getRoomState } from '@/lib/bot-actions';
import { controlGlobalMusicSession, ensureGlobalMusicRoom, requestMusicItem } from '@/lib/music-session-service';

export function parseMusicCommand(message: string) {
  const trimmed = message.trim();
  const requestMatch = trimmed.match(/^!(sr|song)(?:\s+(.+))?$/i);
  if (requestMatch) {
    return {
      command: `!${requestMatch[1].toLowerCase()}`,
      action: 'request' as const,
      query: (requestMatch[2] || '').trim(),
    };
  }

  if (/^!(np|nowplaying)$/i.test(trimmed)) return { command: '!np', action: 'nowPlaying' as const };
  if (/^!status$/i.test(trimmed)) return { command: '!status', action: 'status' as const };
  if (/^!(skip|next)$/i.test(trimmed)) return { command: '!skip', action: 'skip' as const };
  return null;
}

export async function handleMusicCommand(params: {
  message: string;
  userId?: string;
  username: string;
  platform: 'discord' | 'twitch' | 'admin' | 'activity' | 'web';
  // eslint-disable-next-line no-unused-vars
  reply?: (content: string) => void | Promise<void>;
}) {
  const parsed = parseMusicCommand(params.message);
  if (!parsed) return false;

  const roomId = await ensureGlobalMusicRoom();
  const reply = params.reply || (() => undefined);

  if (parsed.action === 'request') {
    if (!parsed.query) {
      await reply(`Usage: ${parsed.command} <song name or YouTube URL>`);
      return true;
    }

    const { result } = await requestMusicItem({
      query: parsed.query,
      username: params.username,
      platform: params.platform,
    });
    await reply(result.success ? `Queued in shared music: ${result.message}` : `Sorry: ${result.message}`);
    return true;
  }

  if (parsed.action === 'nowPlaying') {
    const state = await getRoomState(roomId);
    if (!state?.currentTrack) {
      await reply('Nothing is playing. Use !sr <song> to request one.');
      return true;
    }
    const status = state.isPlaying ? 'Playing' : 'Ready';
    await reply(`${status}: "${state.currentTrack.title}" by ${state.currentTrack.artist}`);
    return true;
  }

  if (parsed.action === 'status') {
    const state = await getRoomState(roomId);
    const status = state?.isPlaying ? 'Playing' : 'Idle';
    await reply(`Shared music: ${status} | DJ: ${state?.djDisplayName || 'None'} | Queue: ${state?.playlistLength || 0}`);
    return true;
  }

  if (parsed.action === 'skip') {
    await controlGlobalMusicSession('next');
    await reply('Skipped to next track.');
    return true;
  }

  return false;
}
