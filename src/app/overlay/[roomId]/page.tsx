'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useCollection, useDoc, useMemoFirebase, useFirebase } from '@/firebase';
import { collection, doc, query, orderBy } from 'firebase/firestore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Image from 'next/image';
import { Music, Mic, LoaderCircle, GripVertical } from 'lucide-react';
import placeholderData from '@/lib/placeholder-images.json';
import { cn } from '@/lib/utils';
import type { PlaylistItem } from '@/types/playlist';
import { useState, useEffect, useRef } from 'react';
import { LiveKitRoom, useVoiceAssistant, useParticipants, useLocalParticipant, useTracks, AudioTrack } from '@livekit/components-react';
import { generateLiveKitToken } from '@/app/actions';
import * as LivekitClient from 'livekit-client';

interface RoomUser {
  id: string;
  displayName: string;
  photoURL: string;
}

interface RoomData {
  name: string;
  ownerId: string;
  playlist: PlaylistItem[];
  currentTrackId: string;
  isPlaying: boolean;
}

interface ChatMessage {
  id: string;
  text: string;
  displayName: string;
  userId: string;
  createdAt: any;
}

interface DraggableProps {
  id: string;
  children: React.ReactNode;
  defaultX?: number;
  defaultY?: number;
}

const Draggable = ({ id, children, defaultX = 0, defaultY = 0 }: DraggableProps) => {
  const [position, setPosition] = useState({ x: defaultX, y: defaultY });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const saved = localStorage.getItem(`overlay-${id}`);
    if (saved) {
      setPosition(JSON.parse(saved));
    }
  }, [id]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-drag-handle]')) {
      setIsDragging(true);
      offsetRef.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newPos = {
          x: e.clientX - offsetRef.current.x,
          y: e.clientY - offsetRef.current.y,
        };
        setPosition(newPos);
      }
    };

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        localStorage.setItem(`overlay-${id}`, JSON.stringify(position));
      }
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, position, id]);

  return (
    <div
      ref={dragRef}
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        cursor: isDragging ? 'grabbing' : 'default',
      }}
    >
      {children}
    </div>
  );
};

const CurrentTrack = ({ room }: { room: RoomData }) => {
  const currentTrack = room.playlist?.find(t => t.id === room.currentTrackId);
  if (!currentTrack) return null;

  const albumArt = placeholderData.placeholderImages.find(p => p.id === currentTrack.artId);

  return (
    <Draggable id="music" defaultX={20} defaultY={500}>
      <div className="rounded-lg bg-black/80 backdrop-blur-md p-4 shadow-2xl min-w-[300px]">
        <div data-drag-handle className="cursor-grab active:cursor-grabbing mb-2 flex items-center gap-2 text-gray-400">
          <GripVertical className="w-4 h-4" />
          <span className="text-xs">Drag to move</span>
        </div>
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
      </div>
    </Draggable>
  );
};

const ParticipantWithVoice = ({ user, isSpeaking }: { user: RoomUser; isSpeaking: boolean }) => (
  <div className="flex flex-col items-center gap-2">
    <div className="relative">
      <Avatar className={cn("h-16 w-16 transition-all", isSpeaking && "ring-4 ring-green-500 ring-offset-2 ring-offset-black/50")}>
        <AvatarImage src={user.photoURL} alt={user.displayName} data-ai-hint="person portrait" />
        <AvatarFallback>{user.displayName?.charAt(0)}</AvatarFallback>
      </Avatar>
      {isSpeaking && (
        <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1 border-2 border-black/50">
          <Mic className="w-3 h-3 text-white" />
        </div>
      )}
    </div>
    <p className="text-sm font-semibold truncate max-w-20">{user.displayName}</p>
  </div>
);

const ParticipantsList = ({ users }: { users: RoomUser[] }) => {
  const participants = useParticipants();
  
  const getSpeakingState = (userId: string) => {
    const participant = participants.find(p => p.identity === userId);
    return participant?.isSpeaking || false;
  };

  return (
    <Draggable id="users" defaultX={20} defaultY={700}>
      <div className="rounded-lg bg-black/80 backdrop-blur-md p-4 shadow-2xl">
        <div data-drag-handle className="cursor-grab active:cursor-grabbing mb-3 flex items-center gap-2 text-gray-400">
          <GripVertical className="w-4 h-4" />
          <span className="text-xs">Drag to move</span>
        </div>
        <div className="flex items-center gap-4 overflow-x-auto pb-2">
          {users.map(user => (
            <ParticipantWithVoice key={user.id} user={user} isSpeaking={getSpeakingState(user.id)} />
          ))}
        </div>
      </div>
    </Draggable>
  );
};

const ChatWidget = ({ roomId }: { roomId: string }) => {
  const { firestore } = useFirebase();
  const scrollRef = useRef<HTMLDivElement>(null);

  const messagesRef = useMemoFirebase(() => {
    if (!firestore || !roomId) return null;
    return collection(firestore, 'rooms', roomId, 'messages');
  }, [firestore, roomId]);

  const messagesQuery = useMemoFirebase(() => {
    if (!messagesRef) return null;
    return query(messagesRef, orderBy('createdAt', 'asc'));
  }, [messagesRef]);

  const { data: messages } = useCollection<ChatMessage>(messagesQuery);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <Draggable id="chat" defaultX={20} defaultY={20}>
      <div className="rounded-lg bg-black/80 backdrop-blur-md shadow-2xl w-[400px] h-[500px] flex flex-col">
        <div data-drag-handle className="cursor-grab active:cursor-grabbing p-3 border-b border-white/10 flex items-center gap-2 text-gray-400">
          <GripVertical className="w-4 h-4" />
          <span className="text-sm font-semibold">Chat</span>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages && messages.length > 0 ? (
            messages.map((msg) => (
              <div key={msg.id} className="text-sm">
                <span className="font-bold text-blue-400 mr-2">{msg.displayName}:</span>
                <span className="text-white">{msg.text}</span>
              </div>
            ))
          ) : (
            <div className="text-center text-gray-400 py-8">No messages yet</div>
          )}
        </div>
      </div>
    </Draggable>
  );
};

function OverlayContent({ room, users, roomId, streamMode }: { room: RoomData; users: RoomUser[]; roomId: string; streamMode: boolean }) {
  const allAudioTracks = useTracks(
    [LivekitClient.Track.Source.Microphone, LivekitClient.Track.Source.Unknown],
    { onlySubscribed: true }
  ).filter(track => track.publication);

  return (
    <div className="min-h-screen bg-transparent text-white relative">
      {streamMode && (
        <>
          <div className="fixed top-4 right-4 bg-red-600/90 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold">
            🔴 STREAM MODE
          </div>
          {allAudioTracks.map((trackRef) => (
            <AudioTrack 
              key={trackRef.publication.trackSid} 
              trackRef={trackRef} 
              volume={1.0}
            />
          ))}
        </>
      )}
      <ChatWidget roomId={roomId} />
      {room.isPlaying && <CurrentTrack room={room} />}
      {users && users.length > 0 && <ParticipantsList users={users} />}
    </div>
  );
}

export default function OverlayPage() {
  const params = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();
  const { firestore, user } = useFirebase();
  const [voiceToken, setVoiceToken] = useState<string>();
  
  const userId = searchParams.get('userId');
  const userInRoomRef = useMemoFirebase(() => {
    if (!firestore || !params.roomId || !userId) return null;
    return doc(firestore, 'rooms', params.roomId, 'users', userId);
  }, [firestore, params.roomId, userId]);
  const { data: userSettings } = useDoc<{ streamMode?: boolean }>(userInRoomRef);

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

  useEffect(() => {
    if (!params.roomId || voiceToken) return;
    
    generateLiveKitToken(params.roomId, 'overlay-viewer', 'Overlay', '{}')
      .then(setVoiceToken)
      .catch(console.error);
  }, [params.roomId, voiceToken]);

  const isLoading = roomLoading || usersLoading;
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (isLoading || !voiceToken || !livekitUrl) {
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
    );
  }

  return (
    <LiveKitRoom
      serverUrl={livekitUrl}
      token={voiceToken}
      connect={true}
      audio={userSettings?.streamMode || false}
      video={false}
      options={{
        autoSubscribe: true,
      }}
    >
      <OverlayContent room={room} users={users || []} roomId={params.roomId} streamMode={userSettings?.streamMode || false} />
    </LiveKitRoom>
  );
}
