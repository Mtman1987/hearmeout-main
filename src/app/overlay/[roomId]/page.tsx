'use client';

import { useParams } from 'next/navigation';
import { useCollection, useDoc, useMemoFirebase, useFirebase } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Image from 'next/image';
import { Music, Mic, LoaderCircle } from 'lucide-react';
import placeholderData from '@/lib/placeholder-images.json';
import { cn } from '@/lib/utils';
import type { PlaylistItem } from '@/types/playlist';

interface RoomUser {
  id: string;
  displayName: string;
  photoURL: string;
  isSpeaking: boolean;
}

interface RoomData {
  name: string;
  ownerId: string;
  playlist: PlaylistItem[];
  currentTrackId: string;
  isPlaying: boolean;
}

const CurrentTrack = ({ room }: { room: RoomData }) => {
  const currentTrack = room.playlist?.find(t => t.id === room.currentTrackId);
  if (!currentTrack) return null;

  const albumArt = placeholderData.placeholderImages.find(p => p.id === currentTrack.artId);

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        {albumArt ? (
          <Image
            src={albumArt.imageUrl}
            alt="Album Art"
            width={80}
            height={80}
            className="rounded-md"
            data-ai-hint={albumArt.imageHint}
          />
        ) : (
          <div className="w-20 h-20 bg-muted rounded-md flex items-center justify-center">
            <Music className="w-8 h-8 text-white/80" />
          </div>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        <p className="text-sm text-gray-300">Now Playing</p>
        <h2 className="text-lg font-bold truncate">{currentTrack.title}</h2>
        <p className="text-sm text-gray-400 truncate">{currentTrack.artist}</p>
      </div>
    </div>
  );
};

const Participant = ({ user }: { user: RoomUser }) => (
  <div className="flex flex-col items-center gap-2">
    <div className="relative">
      <Avatar className={cn("h-16 w-16 transition-all", user.isSpeaking && "ring-4 ring-green-500 ring-offset-2 ring-offset-black/50")}>
        <AvatarImage src={user.photoURL} alt={user.displayName} data-ai-hint="person portrait" />
        <AvatarFallback>{user.displayName?.charAt(0)}</AvatarFallback>
      </Avatar>
      {user.isSpeaking && (
        <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1 border-2 border-black/50">
          <Mic className="w-3 h-3 text-white" />
        </div>
      )}
    </div>
    <p className="text-sm font-semibold truncate max-w-20">{user.displayName}</p>
  </div>
);

export default function OverlayPage() {
  const params = useParams<{ roomId: string }>();
  const { firestore } = useFirebase();

  const roomRef = useMemoFirebase(() => {
    if (!firestore || !params.roomId) return null;
    return doc(firestore, 'rooms', params.roomId);
  }, [firestore, params.roomId]);
  const { data: room, isLoading: roomLoading } = useDoc<RoomData>(roomRef);

  const usersInRoomQuery = useMemoFirebase(() => {
    if (!firestore || !params.roomId) return null;
    return collection(firestore, 'rooms', params.roomId, 'users');
  }, [firestore, params.roomId]);
  const { data: users, isLoading: usersLoading } = useCollection<RoomUser>(usersInRoomQuery);

  const isLoading = roomLoading || usersLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-transparent text-white p-4 flex items-center justify-center">
        <LoaderCircle className="w-10 h-10 animate-spin" />
      </div>
    );
  }

  if (!room) {
    return (
        <div className="min-h-screen bg-transparent text-white p-4 flex items-center justify-center">
            <p>Room not found.</p>
        </div>
    )
  }

  return (
    <div className="min-h-screen bg-transparent text-white p-4 flex flex-col justify-end">
      <div className="w-full rounded-lg bg-black/60 backdrop-blur-md p-4 shadow-2xl animate-in fade-in-50 slide-in-from-bottom-5 duration-500 space-y-4">
        {room.isPlaying && <CurrentTrack room={room} />}
        {users && users.length > 0 && (
          <>
            {room.isPlaying && <div className="border-t border-white/10"></div>}
            <div className="flex items-center gap-4 overflow-x-auto pb-2">
                {users.map(user => (
                    <Participant key={user.id} user={user} />
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
