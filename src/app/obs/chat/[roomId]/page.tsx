'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useDoc, useCollection } from '@/hooks/use-db';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Room } from 'livekit-client';

export default function OBSOverlay() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const opacity = searchParams.get('opacity') || '95';

  const { data: room } = useDoc('rooms', roomId, 2000);
  const { data: users } = useCollection(`rooms/${roomId}/users`, { pollInterval: 3000 });

  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());
  const [livekitRoom, setLivekitRoom] = useState<Room | null>(null);

  useEffect(() => {
    if (!roomId) return;
    const connectToLiveKit = async () => {
      try {
        const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
        if (!livekitUrl) return;
        const lkRoom = new Room();
        const updateSpeaking = () => {
          const speaking = new Set<string>();
          lkRoom.remoteParticipants.forEach((p) => { if (p.isSpeaking) speaking.add(p.identity); });
          if (lkRoom.localParticipant?.isSpeaking) speaking.add(lkRoom.localParticipant.identity);
          setSpeakingUsers(speaking);
        };
        lkRoom.on('participantConnected', updateSpeaking);
        lkRoom.on('participantDisconnected', updateSpeaking);
        lkRoom.on('trackSubscribed', updateSpeaking);

        const response = await fetch('/api/livekit-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, userId: 'overlay', userName: 'Overlay' })
        });
        if (response.ok) {
          const { token } = await response.json();
          await lkRoom.connect(livekitUrl, token);
          setLivekitRoom(lkRoom);
          const interval = setInterval(updateSpeaking, 100);
          return () => clearInterval(interval);
        }
      } catch (error) { console.error('Failed to connect to LiveKit:', error); }
    };
    connectToLiveKit();
    return () => { livekitRoom?.disconnect(); };
  }, [roomId]);

  const currentTrack = room?.playlist?.find((t: any) => t.id === room?.currentTrackId);

  return (
    <div className="w-screen h-screen bg-transparent p-4">
      <div className="w-full h-full rounded-lg border shadow-lg flex flex-col gap-4 p-4" style={{ backgroundColor: `rgba(0, 0, 0, ${parseInt(opacity) / 100})`, backdropFilter: 'blur(8px)' }}>
        <div className="flex-1 overflow-y-auto">
          <h4 className="text-white/80 text-sm font-semibold mb-2 px-2">In Room</h4>
          <div className="space-y-2">
            {users?.map((user: any) => {
              const isSpeaking = speakingUsers.has(user.id);
              return (
                <div key={user.id} className="flex items-center gap-3 p-3 bg-black/30 rounded-lg border transition-all"
                  style={{ borderColor: isSpeaking ? 'rgb(34, 197, 94)' : 'rgba(255, 255, 255, 0.1)', boxShadow: isSpeaking ? '0 0 20px rgba(34, 197, 94, 0.5)' : 'none' }}>
                  <Avatar className="h-10 w-10"><AvatarImage src={user.photoURL} /><AvatarFallback>{user.displayName?.[0] || '?'}</AvatarFallback></Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{user.displayName}</p>
                    {user.id === room?.djId && <p className="text-purple-400 text-xs">DJ</p>}
                  </div>
                  {isSpeaking && (
                    <div className="flex gap-1">
                      <div className="w-1 h-4 bg-green-500 rounded animate-pulse" style={{ animationDelay: '0ms' }} />
                      <div className="w-1 h-4 bg-green-500 rounded animate-pulse" style={{ animationDelay: '150ms' }} />
                      <div className="w-1 h-4 bg-green-500 rounded animate-pulse" style={{ animationDelay: '300ms' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {currentTrack && (
          <div className="flex items-center gap-4 p-4 bg-black/40 rounded-lg border border-white/10">
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-semibold truncate text-sm">{currentTrack.title}</h3>
              <p className="text-white/60 text-xs truncate">{currentTrack.artist}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
