'use client';
import { normalizeWatchSessionAlias } from '@/lib/watch-session';

// Compatibility component: all surfaces use the same player implementation.
// Host/activity flags no longer expose playback controls.
export default function WatchRoomClient({ sessionId }: { sessionId: string; activityMode?: boolean; canPause?: boolean }) {
  return <iframe title="HearMeOut player" src={`/activity?sessionId=${encodeURIComponent(normalizeWatchSessionAlias(sessionId))}`} className="h-screen w-full border-0" allow="autoplay" />;
}
