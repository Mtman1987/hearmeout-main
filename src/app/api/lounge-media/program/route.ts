import { NextResponse } from 'next/server';
import { getPublicWatchSession, getResolvedWatchSession } from '@/lib/watch-request-service';
import {
  SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID,
  SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID,
} from '@/lib/spacemountain-lounge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Expose only the current broadcast item to the public browser source.
// Other watch sessions, requesters, queue entries and control routes stay private.
function currentProgram(sessionId: string) {
  const session = getPublicWatchSession(getResolvedWatchSession(sessionId));
  const item = session.current?.item;
  return {
    current: item ? {
      requestId: session.current!.requestId,
      item: {
        type: item.type,
        title: item.title,
        artist: item.metadata?.artist,
        source: item.source,
        runtime: item.runtime,
        overview: item.overview,
        playbackUrl: item.playbackUrl,
        metadata: {
          provider: item.metadata?.provider,
          videoPlaybackUrl: item.metadata?.videoPlaybackUrl,
          embedPlaybackUrl: item.metadata?.embedPlaybackUrl,
          audioPlaybackUrl: item.metadata?.audioPlaybackUrl,
        },
      },
    } : null,
    playback: session.playback,
    queue: [],
  };
}

export function GET() {
  return NextResponse.json({
    movie: currentProgram(SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID),
    music: currentProgram(SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID),
  }, { headers: { 'cache-control': 'no-store' } });
}
