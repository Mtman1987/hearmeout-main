'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { useCollection } from 'react-firebase-hooks/firestore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useVoiceAssistant } from '@livekit/components-react';
import { useRemoteParticipants } from '@livekit/components-react';

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
  
  const { firestore } = useFirebase();
  const participants = useRemoteParticipants();
  
  const roomRef = useMemoFirebase(() => {
    if (!firestore || !roomId) return null;
    return doc(firestore, 'rooms', roomId);
  }, [firestore, roomId]);

  const { data: room } = useDoc<any>(roomRef);
  
  const usersRef = useMemoFirebase(() => {
    if (!firestore || !roomId) return null;
    return collection(firestore, 'rooms', roomId, 'users');
  }, [firestore, roomId]);
  
  const [usersSnapshot] = useCollection(usersRef);
  const users = usersSnapshot?.docs.map(d => ({ id: d.id, ...d.data() })) || [];

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
              const participant = participants.find(p => p.identity === user.id);
              const isSpeaking = participant?.isSpeaking || false;
              
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
