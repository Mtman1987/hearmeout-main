'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useCollection, useDoc, useMemoFirebase, useFirebase } from '@/firebase';
import { collection, doc, query, orderBy } from 'firebase/firestore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Image from 'next/image';
import { Music, Mic, LoaderCircle, GripVertical, X, MessageSquare, Users, ListMusic } from 'lucide-react';
import placeholderData from '@/lib/placeholder-images.json';
import { cn } from '@/lib/utils';
import type { PlaylistItem } from '@/types/playlist';
import { useState, useEffect, useRef } from 'react';
import { LiveKitRoom, useParticipants, useTracks, AudioTrack } from '@livekit/components-react';
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

interface DraggableProps {
  id: string;
  children: React.ReactNode;
  defaultX?: number;
  defaultY?: number;
  lockAxis?: 'x' | 'y';
  onClose?: () => void;
}

const Draggable = ({ id, children, defaultX = 0, defaultY = 0, lockAxis, onClose }: DraggableProps) => {
  const [position, setPosition] = useState({ x: defaultX, y: defaultY });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const saved = localStorage.getItem(`overlay-${id}`);
    if (saved) setPosition(JSON.parse(saved));
  }, [id]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-drag-handle]')) {
      setIsDragging(true);
      offsetRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newPos = {
          x: lockAxis === 'y' ? position.x : e.clientX - offsetRef.current.x,
          y: lockAxis === 'x' ? position.y : e.clientY - offsetRef.current.y,
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
      style={{ position: 'absolute', left: `${position.x}px`, top: `${position.y}px`, cursor: isDragging ? 'grabbing' : 'default' }}
      className="group"
    >
      {onClose && (
        <button onClick={onClose} className="absolute -top-2 -right-2 z-50 bg-red-600 hover:bg-red-700 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <X className="w-3 h-3 text-white" />
        </button>
      )}
      {children}
    </div>
  );
};

const CurrentTrack = ({ room, onClose }: { room: RoomData; onClose: () => void }) => {
  const currentTrack = room.playlist?.find(t => t.id === room.currentTrackId);
  if (!currentTrack) return null;
  const albumArt = placeholderData.placeholderImages.find(p => p.id === currentTrack.artId);

  return (
    <Draggable id="music" defaultX={20} defaultY={500} onClose={onClose}>
      <div className="rounded-lg bg-black/80 backdrop-blur-md p-4 shadow-2xl min-w-[300px]">
        <div data-drag-handle className="cursor-grab active:cursor-grabbing mb-2 flex items-center gap-2 text-gray-400">
          <GripVertical className="w-4 h-4" />
          <span className="text-xs">Drag to move</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            {albumArt ? (
              <Image src={albumArt.imageUrl} alt="Album Art" width={80} height={80} className="rounded-md" data-ai-hint={albumArt.imageHint} />
            ) : (
              <div className="w-20 h-20 bg-muted rounded-md flex items-center justify-center"><Music className="w-8 h-8 text-white/80" /></div>
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

const ParticipantWithVoice = ({ user, isSpeaking, index, onClose }: { user: RoomUser; isSpeaking: boolean; index: number; onClose: () => void }) => (
  <Draggable id={`user-${user.id}`} defaultX={20} defaultY={20 + (index * 100)} lockAxis="y" onClose={onClose}>
    <div className="rounded-lg bg-black/80 backdrop-blur-md p-3 shadow-2xl">
      <div data-drag-handle className="cursor-grab active:cursor-grabbing mb-2 flex items-center gap-2 text-gray-400">
        <GripVertical className="w-3 h-3" />
        <span className="text-xs">Drag</span>
      </div>
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
    </div>
  </Draggable>
);

const ParticipantsList = ({ users, hiddenUsers, onHideUser }: { users: RoomUser[]; hiddenUsers: Set<string>; onHideUser: (userId: string) => void }) => {
  const participants = useParticipants();
  const getSpeakingState = (userId: string) => participants.find(p => p.identity === userId)?.isSpeaking || false;

  return (
    <>
      {users.filter(u => !hiddenUsers.has(u.id)).map((user, index) => (
        <ParticipantWithVoice key={user.id} user={user} isSpeaking={getSpeakingState(user.id)} index={index} onClose={() => onHideUser(user.id)} />
      ))}
    </>
  );
};

const ChatWidget = ({ roomId, onClose }: { roomId: string; onClose: () => void }) => {
  const { firestore, user } = useFirebase();
  const [viewMode, setViewMode] = useState<'tabbed' | 'split-v' | 'split-h'>('tabbed');
  const [messages, setMessages] = useState<any[]>([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [lastMessageId, setLastMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const userInRoomRef = useMemoFirebase(() => {
    if (!firestore || !roomId || !user) return null;
    return doc(firestore, 'rooms', roomId, 'users', user.uid);
  }, [firestore, roomId, user]);

  const { data: firestoreUser } = useDoc<{ discordSelectedChannel?: string }>(userInRoomRef);

  useEffect(() => {
    if (firestoreUser?.discordSelectedChannel) setSelectedChannel(firestoreUser.discordSelectedChannel);
  }, [firestoreUser]);

  useEffect(() => {
    if (!selectedChannel) return;
    const pollMessages = async () => {
      try {
        const url = lastMessageId ? `/api/discord/messages?channelId=${selectedChannel}&after=${lastMessageId}` : `/api/discord/messages?channelId=${selectedChannel}&limit=50`;
        const res = await fetch(url);
        if (!res.ok) return;
        const newMessages = await res.json();
        if (Array.isArray(newMessages) && newMessages.length > 0) {
          const msgs = newMessages.reverse().map((msg: any) => ({
            id: msg.id,
            author: msg.author.username,
            content: msg.content,
            avatarUrl: msg.author.avatar ? `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png` : undefined,
          }));
          setMessages(prev => [...prev, ...msgs]);
          setLastMessageId(newMessages[newMessages.length - 1].id);
        }
      } catch (err) {
        console.error('Failed to poll messages:', err);
      }
    };
    pollMessages();
    const interval = setInterval(pollMessages, 5000);
    return () => clearInterval(interval);
  }, [selectedChannel, lastMessageId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <Draggable id="chat" defaultX={20} defaultY={20} onClose={onClose}>
      <div className="rounded-lg bg-black/80 backdrop-blur-md shadow-2xl w-[400px] h-[500px] flex flex-col">
        <div data-drag-handle className="cursor-grab active:cursor-grabbing p-2 border-b border-white/10 flex items-center gap-2">
          <GripVertical className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-semibold">Chat</span>
          <select value={viewMode} onChange={(e) => setViewMode(e.target.value as any)} className="ml-auto text-xs px-2 py-1 rounded border bg-black/50 text-white">
            <option value="tabbed">Tabbed</option>
          </select>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {messages.map((msg) => (
            <div key={msg.id} className="text-xs flex gap-2">
              {msg.avatarUrl && <img src={msg.avatarUrl} alt={msg.author} className="w-6 h-6 rounded-full" />}
              <div>
                <span className="font-bold text-blue-400">{msg.author}: </span>
                <span className="text-white">{msg.content}</span>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </Draggable>
  );
};

const VoiceQueue = ({ roomId, onClose }: { roomId: string; onClose: () => void }) => {
  const { firestore } = useFirebase();
  const queueRef = useMemoFirebase(() => firestore && roomId ? collection(firestore, 'rooms', roomId, 'voiceQueue') : null, [firestore, roomId]);
  const queueQuery = useMemoFirebase(() => queueRef ? query(queueRef, orderBy('addedAt', 'asc')) : null, [queueRef]);
  const { data: queue } = useCollection<any>(queueQuery);

  return (
    <Draggable id="queue" defaultX={1500} defaultY={20} onClose={onClose}>
      <div className="rounded-lg bg-black/80 backdrop-blur-md p-4 shadow-2xl min-w-[250px]">
        <div data-drag-handle className="cursor-grab active:cursor-grabbing mb-3 flex items-center gap-2 text-gray-400">
          <GripVertical className="w-4 h-4" />
          <span className="text-sm font-semibold">Voice Queue</span>
        </div>
        <div className="space-y-2">
          {queue && queue.length > 0 ? queue.map((item, index) => (
            <div key={item.id} className="flex items-center gap-2 text-sm">
              <span className="text-gray-400">#{index + 1}</span>
              <span className="text-white">{item.username}</span>
            </div>
          )) : <div className="text-center text-gray-400 text-sm">No one in queue</div>}
        </div>
      </div>
    </Draggable>
  );
};

const OverlayControls = ({ visible, onToggle, hiddenUsers, users, onShowUser }: { 
  visible: { chat: boolean; music: boolean; queue: boolean };
  onToggle: (key: 'chat' | 'music' | 'queue') => void;
  hiddenUsers: Set<string>;
  users: RoomUser[];
  onShowUser: (userId: string) => void;
}) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  
  return (
    <div className="fixed top-4 right-4 bg-black/80 backdrop-blur-md rounded-lg p-2 shadow-2xl flex gap-2">
      <button onClick={() => onToggle('chat')} className={`p-2 rounded ${visible.chat ? 'bg-blue-600' : 'bg-gray-700'}`} title="Toggle Chat">
        <MessageSquare className="w-4 h-4" />
      </button>
      <button onClick={() => onToggle('music')} className={`p-2 rounded ${visible.music ? 'bg-blue-600' : 'bg-gray-700'}`} title="Toggle Music">
        <Music className="w-4 h-4" />
      </button>
      <button onClick={() => onToggle('queue')} className={`p-2 rounded ${visible.queue ? 'bg-blue-600' : 'bg-gray-700'}`} title="Toggle Queue">
        <ListMusic className="w-4 h-4" />
      </button>
      <div className="relative">
        <button onClick={() => setShowUserMenu(!showUserMenu)} className="p-2 rounded bg-gray-700 relative" title="Show Hidden Profiles">
          <Users className="w-4 h-4" />
          {hiddenUsers.size > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{hiddenUsers.size}</span>
          )}
        </button>
        {showUserMenu && hiddenUsers.size > 0 && (
          <div className="absolute top-full right-0 mt-1 bg-black/90 rounded-lg p-2 min-w-[150px] space-y-1">
            {users.filter(u => hiddenUsers.has(u.id)).map(user => (
              <button key={user.id} onClick={() => { onShowUser(user.id); if (hiddenUsers.size === 1) setShowUserMenu(false); }}
                className="w-full text-left px-2 py-1 text-sm hover:bg-gray-700 rounded flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={user.photoURL} />
                  <AvatarFallback>{user.displayName?.charAt(0)}</AvatarFallback>
                </Avatar>
                {user.displayName}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function OverlayContent({ room, users, roomId, streamMode }: { room: RoomData; users: RoomUser[]; roomId: string; streamMode: boolean }) {
  const [visible, setVisible] = useState({ chat: true, music: true, queue: true });
  const [hiddenUsers, setHiddenUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    const saved = localStorage.getItem('overlay-visible');
    if (saved) setVisible(JSON.parse(saved));
    const savedUsers = localStorage.getItem('overlay-hidden-users');
    if (savedUsers) setHiddenUsers(new Set(JSON.parse(savedUsers)));
    localStorage.setItem('overlay-open', 'true');
    return () => {
      localStorage.setItem('overlay-open', 'false');
      window.dispatchEvent(new Event('storage'));
    };
  }, []);

  const toggleVisible = (key: 'chat' | 'music' | 'queue') => {
    const newVisible = { ...visible, [key]: !visible[key] };
    setVisible(newVisible);
    localStorage.setItem('overlay-visible', JSON.stringify(newVisible));
  };

  const hideUser = (userId: string) => {
    const newHidden = new Set(hiddenUsers);
    newHidden.add(userId);
    setHiddenUsers(newHidden);
    localStorage.setItem('overlay-hidden-users', JSON.stringify([...newHidden]));
  };

  const showUser = (userId: string) => {
    const newHidden = new Set(hiddenUsers);
    newHidden.delete(userId);
    setHiddenUsers(newHidden);
    localStorage.setItem('overlay-hidden-users', JSON.stringify([...newHidden]));
  };

  const allAudioTracks = useTracks([LivekitClient.Track.Source.Microphone, LivekitClient.Track.Source.Unknown], { onlySubscribed: true }).filter(track => track.publication);

  return (
    <div className="min-h-screen bg-transparent text-white relative">
      {streamMode && allAudioTracks.map((trackRef) => <AudioTrack key={trackRef.publication.trackSid} trackRef={trackRef} volume={1.0} />)}
      {visible.chat && <ChatWidget roomId={roomId} onClose={() => toggleVisible('chat')} />}
      {visible.music && room.isPlaying && <CurrentTrack room={room} onClose={() => toggleVisible('music')} />}
      {visible.queue && <VoiceQueue roomId={roomId} onClose={() => toggleVisible('queue')} />}
      {users && users.length > 0 && <ParticipantsList users={users} hiddenUsers={hiddenUsers} onHideUser={hideUser} />}
    </div>
  );
}

export default function OverlayPage() {
  const params = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();
  const { firestore } = useFirebase();
  const [voiceToken, setVoiceToken] = useState<string>();
  
  const userId = searchParams.get('userId');
  const userInRoomRef = useMemoFirebase(() => firestore && params.roomId && userId ? doc(firestore, 'rooms', params.roomId, 'users', userId) : null, [firestore, params.roomId, userId]);
  const { data: userSettings } = useDoc<{ streamMode?: boolean }>(userInRoomRef);

  const roomRef = useMemoFirebase(() => firestore && params.roomId ? doc(firestore, 'rooms', params.roomId) : null, [firestore, params.roomId]);
  const { data: room, isLoading: roomLoading } = useDoc<RoomData>(roomRef);

  const usersInRoomQuery = useMemoFirebase(() => firestore && params.roomId ? collection(firestore, 'rooms', params.roomId, 'users') : null, [firestore, params.roomId]);
  const { data: users, isLoading: usersLoading } = useCollection<RoomUser>(usersInRoomQuery);

  useEffect(() => {
    if (!params.roomId || voiceToken) return;
    generateLiveKitToken(params.roomId, 'overlay-viewer', 'Overlay', '{}').then(setVoiceToken).catch(console.error);
  }, [params.roomId, voiceToken]);

  const isLoading = roomLoading || usersLoading;
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (isLoading || !voiceToken || !livekitUrl) {
    return <div className="min-h-screen bg-transparent text-white p-4 flex items-center justify-center"><LoaderCircle className="w-10 h-10 animate-spin" /></div>;
  }

  if (!room) {
    return <div className="min-h-screen bg-transparent text-white p-4 flex items-center justify-center"><p>Room not found.</p></div>;
  }

  return (
    <LiveKitRoom serverUrl={livekitUrl} token={voiceToken} connect={true} audio={userSettings?.streamMode || false} video={false} options={{ autoSubscribe: true }}>
      <OverlayContent room={room} users={users || []} roomId={params.roomId} streamMode={userSettings?.streamMode || false} />
    </LiveKitRoom>
  );
}
