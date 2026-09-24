import { SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID, SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID } from '@/lib/spacemountain-lounge';
import { getPublicWatchSession, getResolvedWatchSession } from '@/lib/watch-request-service';

export type LoungeLane = 'music' | 'movie';

export function getLoungeLane(): LoungeLane {
  const music = getResolvedWatchSession(SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID);
  const movie = getResolvedWatchSession(SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID);
  // StreamWeaver's !music and !movie controls record a Played event. A !wr
  // request only queues a movie and must not switch the on-air lane.
  const lastPlay = (session: typeof music) => [...session.events].reverse().find(event => /^(?:Played|Loaded) /.test(event.message))?.at || '';
  return lastPlay(movie) > lastPlay(music) ? 'movie' : 'music';
}

export async function getLoungeSourceState() {
  const lane = getLoungeLane();
  const sessionId = lane === 'music' ? SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID : SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID;
  const session = getPublicWatchSession(getResolvedWatchSession(sessionId));
  // Historic shared sessions defaulted to muted before any owner ever pressed
  // mute. Only an explicit mute command should silence the unattended source.
  const lastMute = [...session.events].reverse().find(event => /^(?:Muted|Unmuted)\b/.test(event.message));
  return { lane, session: { ...session, playback: { ...session.playback, muted: lastMute?.message.startsWith('Muted') || false } } };
}
