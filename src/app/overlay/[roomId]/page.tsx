"use client";
import { useParams, useSearchParams } from 'next/navigation';
import { useCollection } from '@/hooks/use-db';
import { getRoomWatchSessionId } from '@/lib/watch-session';

export default function OverlayPage() {
  const { roomId } = useParams<{roomId: string}>();
  const params = useSearchParams();
  const media = params.get('media');
  const session = media === 'music' || media === 'movie' ? `?sessionId=${getRoomWatchSessionId(roomId, media)}` : '';
  const { data: profiles } = useCollection<{id: string; displayName?: string; photoURL?: string; lastSeen?: number; bot?: boolean}>(`rooms/${roomId}/users`, {pollInterval: 3000});
  const active = (profiles || []).filter(profile => profile.bot || Number(profile.lastSeen) > Date.now() - 45000);
  return <main className="relative h-screen w-screen bg-transparent">
    <iframe title="HearMeOut player" src={`/activity${session}`} className="h-full w-full border-0" allow="autoplay" />
    {!!active.length && <div className="pointer-events-none absolute right-4 top-4 flex flex-wrap gap-2">
      {active.map(profile => <div key={profile.id} className="rounded-md bg-black/80 px-3 py-2 text-xs text-white">{profile.displayName || 'Listener'}</div>)}
    </div>}
  </main>;
}
