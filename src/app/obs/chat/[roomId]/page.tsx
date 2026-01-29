'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { doc, collection, onSnapshot } from 'firebase/firestore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const firestore = getFirestore(app);

interface ChatMessage {
  id: string;
  author: string;
  content: string;
  timestamp: Date;
  platform: 'discord' | 'twitch';
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

export default function OBSOverlay() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const opacity = searchParams.get('opacity') || '95';
  
  const [room, setRoom] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!roomId) return;
    
    const roomRef = doc(firestore, 'rooms', roomId);
    const unsubRoom = onSnapshot(roomRef, (doc) => {
      if (doc.exists()) {
        setRoom({ id: doc.id, ...doc.data() });
      }
    });

    const usersRef = collection(firestore, 'rooms', roomId, 'users');
    const unsubUsers = onSnapshot(usersRef, (snapshot) => {
      const usersList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setUsers(usersList);
    });

    return () => {
      unsubRoom();
      unsubUsers();
    };
  }, [roomId]);

  // Simulate speaking detection (in real app, this would come from LiveKit)
  useEffect(() => {
    const interval = setInterval(() => {
      // This is a placeholder - real implementation would use LiveKit participant.isSpeaking
      setSpeakingUsers(new Set());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const currentTrack = room?.playlist?.find((t: any) => t.id === room?.currentTrackId);

  return (
    <div className="w-screen h-screen bg-transparent p-4">
      <div 
        className="w-full h-full rounded-lg border shadow-lg flex flex-col gap-4 p-4"
        style={{ 
          backgroundColor: `rgba(0, 0, 0, ${parseInt(opacity) / 100})`,
          backdropFilter: 'blur(8px)'
        }}
      >
        {/* Now Playing */}
        {currentTrack && (
          <div className="flex items-center gap-4 p-4 bg-black/40 rounded-lg border border-white/10">
            <img 
              src={currentTrack.thumbnail} 
              alt={currentTrack.title}
              className="w-20 h-20 rounded object-cover"
            />
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-semibold truncate">{currentTrack.title}</h3>
              <p className="text-white/60 text-sm truncate">{currentTrack.artist}</p>
            </div>
          </div>
        )}

        {/* Users */}
        <div className="flex-1 overflow-y-auto">
          <h4 className="text-white/80 text-sm font-semibold mb-2 px-2">In Room</h4>
          <div className="space-y-2">
            {users.map((user: any) => {
              const isSpeaking = speakingUsers.has(user.id);
              
              return (
                <div 
                  key={user.id}
                  className="flex items-center gap-3 p-3 bg-black/30 rounded-lg border transition-all"
                  style={{
                    borderColor: isSpeaking ? 'rgb(34, 197, 94)' : 'rgba(255, 255, 255, 0.1)',
                    boxShadow: isSpeaking ? '0 0 20px rgba(34, 197, 94, 0.5)' : 'none'
                  }}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={user.photoURL} />
                    <AvatarFallback>{user.displayName?.[0] || '?'}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{user.displayName}</p>
                    {user.id === room?.djId && (
                      <p className="text-purple-400 text-xs">DJ</p>
                    )}
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
      </div>
    </div>
  );
}
