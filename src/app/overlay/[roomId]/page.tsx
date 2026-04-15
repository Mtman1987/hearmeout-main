'use client';

import { useParams } from 'next/navigation';
import { useDoc, useCollection } from '@/hooks/use-db';
import { dbUpdate } from '@/lib/db-helpers';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Music, Mic, LoaderCircle, GripVertical, X, ListMusic } from 'lucide-react';
import Image from 'next/image';
import placeholderData from '@/lib/placeholder-images.json';
import { cn } from '@/lib/utils';
import type { PlaylistItem } from '@/types/playlist';
import { useState, useEffect, useRef, useCallback } from 'react';
import { LiveKitRoom, useParticipants, useTracks, AudioTrack } from '@livekit/components-react';
import * as LivekitClient from 'livekit-client';

interface RoomUser { id: string; displayName: string; photoURL: string; }
interface RoomData { name: string; ownerId: string; playlist: PlaylistItem[]; currentTrackId: string; isPlaying: boolean; overlayVisible?: { chat: boolean; music: boolean; queue: boolean }; }

// --- Draggable wrapper ---
const Draggable = ({ id, children, defaultX = 0, defaultY = 0, onClose }: { id: string; children: React.ReactNode; defaultX?: number; defaultY?: number; onClose?: () => void }) => {
  const [position, setPosition] = useState({ x: defaultX, y: defaultY });
  const [isDragging, setIsDragging] = useState(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  useEffect(() => { const saved = localStorage.getItem(`overlay-${id}`); if (saved) setPosition(JSON.parse(saved)); }, [id]);
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-drag-handle]')) { setIsDragging(true); offsetRef.current = { x: e.clientX - position.x, y: e.clientY - position.y }; }
  };
  useEffect(() => {
    const move = (e: MouseEvent) => { if (isDragging) setPosition({ x: e.clientX - offsetRef.current.x, y: e.clientY - offsetRef.current.y }); };
    const up = () => { if (isDragging) { setIsDragging(false); localStorage.setItem(`overlay-${id}`, JSON.stringify(position)); } };
    if (isDragging) { document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); }
    return () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
  }, [isDragging, position, id]);
  return (
    <div onMouseDown={handleMouseDown} style={{ position: 'absolute', left: `${position.x}px`, top: `${position.y}px`, cursor: isDragging ? 'grabbing' : 'default' }} className="group">
      {onClose && <button onClick={onClose} className="absolute -top-2 -right-2 z-50 bg-red-600 hover:bg-red-700 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3 h-3 text-white" /></button>}
      {children}
    </div>
  );
};

// --- Now Playing widget ---
const CurrentTrackWidget = ({ track }: { track: PlaylistItem }) => {
  const albumArt = track.thumbnail || placeholderData.placeholderImages.find(p => p.id === track.artId)?.imageUrl;
  return (
    <Draggable id="music" defaultX={20} defaultY={500}>
      <div className="rounded-lg bg-black/80 backdrop-blur-md p-4 shadow-2xl min-w-[300px]">
        <div data-drag-handle className="cursor-grab active:cursor-grabbing mb-2 flex items-center gap-2 text-gray-400"><GripVertical className="w-4 h-4" /><span className="text-xs">Now Playing</span></div>
        <div className="flex items-center gap-4">
          {albumArt ? <Image src={albumArt} alt="" width={80} height={80} className="rounded-md" unoptimized /> : <div className="w-20 h-20 bg-muted rounded-md flex items-center justify-center"><Music className="w-8 h-8 text-white/80" /></div>}
          <div className="flex-1 overflow-hidden"><h2 className="text-lg font-bold truncate">{track.title}</h2><p className="text-sm text-gray-400 truncate">{track.artist}</p></div>
        </div>
      </div>
    </Draggable>
  );
};

// --- Participant cards ---
const ParticipantWithVoice = ({ user, isSpeaking, index, onClose }: { user: RoomUser; isSpeaking: boolean; index: number; onClose: () => void }) => (
  <Draggable id={`user-${user.id}`} defaultX={20} defaultY={20 + (index * 100)} onClose={onClose}>
    <div className="rounded-lg bg-black/80 backdrop-blur-md p-3 shadow-2xl">
      <div data-drag-handle className="cursor-grab active:cursor-grabbing mb-2 flex items-center gap-2 text-gray-400"><GripVertical className="w-3 h-3" /><span className="text-xs">Drag</span></div>
      <div className="flex flex-col items-center gap-2">
        <Avatar className={cn("h-16 w-16 transition-all", isSpeaking && "ring-4 ring-green-500 ring-offset-2 ring-offset-black/50")}><AvatarImage src={user.photoURL} /><AvatarFallback>{user.displayName?.charAt(0)}</AvatarFallback></Avatar>
        {isSpeaking && <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1 border-2 border-black/50"><Mic className="w-3 h-3 text-white" /></div>}
        <p className="text-sm font-semibold truncate max-w-20">{user.displayName}</p>
      </div>
    </div>
  </Draggable>
);

const ParticipantsList = ({ users, hiddenUsers, onHideUser }: { users: RoomUser[]; hiddenUsers: Set<string>; onHideUser: (userId: string) => void }) => {
  const participants = useParticipants();
  const getSpeaking = (uid: string) => participants.find(p => p.identity === uid)?.isSpeaking || false;
  return <>{users.filter(u => !hiddenUsers.has(u.id)).map((u, i) => <ParticipantWithVoice key={u.id} user={u} isSpeaking={getSpeaking(u.id)} index={i} onClose={() => onHideUser(u.id)} />)}</>;
};

// --- Music player (audio element, single source of truth) ---
function MusicPlayer({ room, roomId }: { room: RoomData; roomId: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [status, setStatus] = useState('idle');
  const [err, setErr] = useState<string | null>(null);

  const track = room.playlist?.find(t => t.id === room.currentTrackId);

  const next = useCallback(() => {
    const { playlist, currentTrackId } = room;
    if (!playlist || playlist.length === 0) return;
    const i = playlist.findIndex(t => t.id === currentTrackId);
    dbUpdate('rooms', roomId, { currentTrackId: playlist[(i + 1) % playlist.length].id, isPlaying: true });
  }, [room, roomId]);

  // Track changed or play toggled
  useEffect(() => {
    if (!track || !room.isPlaying) {
      if (audioRef.current) audioRef.current.pause();
      setPlayingId(null);
      setStatus(room.isPlaying ? 'no track' : 'paused');
      return;
    }
    if (playingId === track.id) return; // already playing this one

    let cancelled = false;
    const load = async () => {
      setStatus('downloading...');
      setErr(null);
      try {
        let vid = track.id;
        try {
          const parsed = new URL(track.url);
          vid = parsed.searchParams.get('v') || parsed.pathname.slice(1) || track.id;
        } catch {}
        if (!vid) { setErr('no video id'); setStatus('error'); return; }

        const trackUrl = track.url || `https://youtube.com/watch?v=${vid}`;
        const r = await fetch(`/api/youtube-audio?videoId=${vid}&url=${encodeURIComponent(trackUrl)}`);
        if (!r.ok) { setErr(`API ${r.status}: ${(await r.text()).slice(0, 100)}`); setStatus('error'); return; }
        const data = await r.json();
        if (!data.audioUrl) { setErr('no audioUrl in response'); setStatus('error'); return; }
        if (cancelled) return;

        if (!audioRef.current) audioRef.current = new Audio();
        const a = audioRef.current;
        a.src = data.audioUrl;
        a.volume = 1.0;
        a.onended = next;
        a.onerror = () => { setErr(a.error?.message || 'playback error'); setStatus('error'); setTimeout(next, 2000); };

        setStatus('buffering...');
        await a.play();
        if (cancelled) { a.pause(); return; }
        setPlayingId(track.id);
        setStatus('playing');
      } catch (e: any) {
        if (!cancelled) { setErr(e.message || String(e)); setStatus('error'); }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [track?.id, room.isPlaying]);

  // Pause/resume
  useEffect(() => {
    if (!audioRef.current || !playingId) return;
    if (room.isPlaying && audioRef.current.paused) audioRef.current.play().catch(() => {});
    if (!room.isPlaying && !audioRef.current.paused) audioRef.current.pause();
  }, [room.isPlaying, playingId]);

  useEffect(() => () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; } }, []);

  // Debug panel — remove this after confirming it works
  return (
    <Draggable id="debug-player" defaultX={20} defaultY={400}>
      <div className="rounded-lg bg-black/90 backdrop-blur-md p-4 shadow-2xl min-w-[300px] text-white text-xs font-mono">
        <div data-drag-handle className="cursor-grab active:cursor-grabbing mb-2 flex items-center gap-2 text-yellow-400"><GripVertical className="w-4 h-4" /><span>🎵 Music Debug</span></div>
        <div className="space-y-0.5">
          <p>track: {track?.title?.slice(0, 40) || 'none'}</p>
          <p>status: <span className={status === 'playing' ? 'text-green-400' : status === 'error' ? 'text-red-400' : 'text-yellow-400'}>{status}</span></p>
          <p>playingId: {playingId?.slice(0, 15) || 'none'}</p>
          {err && <p className="text-red-400">err: {err}</p>}
        </div>
      </div>
    </Draggable>
  );
}

// --- Overlay content ---
function OverlayContent({ room, users, roomId }: { room: RoomData; users: RoomUser[]; roomId: string }) {
  const visible = room.overlayVisible || { chat: true, music: true, queue: true };
  const [hiddenUsers, setHiddenUsers] = useState<Set<string>>(new Set());
  useEffect(() => {
    const saved = localStorage.getItem('overlay-hidden-users'); if (saved) setHiddenUsers(new Set(JSON.parse(saved)));
    localStorage.setItem('overlay-open', 'true');
    return () => { localStorage.setItem('overlay-open', 'false'); };
  }, []);
  const hideUser = (uid: string) => { const s = new Set(hiddenUsers); s.add(uid); setHiddenUsers(s); localStorage.setItem('overlay-hidden-users', JSON.stringify([...s])); };

  const voiceTracks = useTracks([LivekitClient.Track.Source.Microphone, LivekitClient.Track.Source.Unknown], { onlySubscribed: true }).filter(t => t.publication);
  const currentTrack = room.playlist?.find(t => t.id === room.currentTrackId);
  const upNext = room.playlist?.filter(t => t.id !== room.currentTrackId) || [];

  return (
    <div className="min-h-screen bg-transparent text-white relative">
      {/* Voice — subscribe only, no mic publishing */}
      {voiceTracks.map(t => <AudioTrack key={t.publication.trackSid} trackRef={t} volume={1.0} />)}

      {/* Music — single audio element, only plays here */}
      <MusicPlayer room={room} roomId={roomId} />

      {visible.music && room.isPlaying && currentTrack && <CurrentTrackWidget track={currentTrack} />}

      {visible.queue && upNext.length > 0 && (
        <Draggable id="queue" defaultX={20} defaultY={620}>
          <div className="rounded-lg bg-black/80 backdrop-blur-md p-4 shadow-2xl min-w-[280px] max-w-[320px]">
            <div data-drag-handle className="cursor-grab active:cursor-grabbing mb-2 flex items-center gap-2 text-gray-400"><GripVertical className="w-4 h-4" /><ListMusic className="w-4 h-4" /><span className="text-xs">Up Next ({upNext.length})</span></div>
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {upNext.slice(0, 5).map((t, i) => (
                <div key={t.id} className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500 w-4 text-right">{i + 1}</span>
                  <div className="flex-1 overflow-hidden"><p className="truncate">{t.title}</p><p className="text-xs text-gray-500 truncate">{t.artist}</p></div>
                </div>
              ))}
            </div>
          </div>
        </Draggable>
      )}

      {users && users.length > 0 && <ParticipantsList users={users} hiddenUsers={hiddenUsers} onHideUser={hideUser} />}
    </div>
  );
}

// --- Page ---
export default function OverlayPage() {
  const params = useParams<{ roomId: string }>();
  const [voiceToken, setVoiceToken] = useState<string>();
  const { data: room, isLoading: roomLoading } = useDoc<RoomData>('rooms', params.roomId);
  const { data: users, isLoading: usersLoading } = useCollection<RoomUser>(`rooms/${params.roomId}/users`);

  useEffect(() => {
    if (!params.roomId || voiceToken) return;
    fetch('/api/livekit-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: params.roomId, userId: 'overlay-viewer', userName: 'Overlay' }),
    }).then(r => r.json()).then(d => { if (d.token) setVoiceToken(d.token); }).catch(console.error);
  }, [params.roomId, voiceToken]);

  const lkUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (roomLoading || usersLoading || !voiceToken || !lkUrl) return <div className="min-h-screen bg-transparent text-white flex items-center justify-center"><LoaderCircle className="w-10 h-10 animate-spin" /></div>;
  if (!room) return <div className="min-h-screen bg-transparent text-white flex items-center justify-center"><p>Room not found.</p></div>;

  return (
    <LiveKitRoom serverUrl={lkUrl} token={voiceToken} connect={true} audio={false} video={false} options={{ autoSubscribe: true }}>
      <OverlayContent room={room} users={users || []} roomId={params.roomId} />
    </LiveKitRoom>
  );
}
