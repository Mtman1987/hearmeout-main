'use client';

import React, { useState, useEffect } from 'react';
import { DraggableContainer } from './DraggableContainer';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, Loader2 } from 'lucide-react';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc, updateDoc, setDoc } from 'firebase/firestore';

interface ChatWidgetProps {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onClose: () => void;
  roomId: string;
}

interface ChatMessage {
  id: string;
  author: string;
  content: string;
  timestamp: Date;
  platform: 'discord' | 'twitch';
  badge?: 'mod' | 'sub' | 'vip';
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

export function ChatWidget({
  id,
  position,
  size,
  onPositionChange,
  onSizeChange,
  onClose,
  roomId,
}: ChatWidgetProps) {
  const { firestore, user } = useFirebase();
  const [selectedChannel, setSelectedChannel] = useState('');
  const [viewMode, setViewMode] = useState<'tabbed' | 'split-v' | 'split-h'>('tabbed');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [discordGuildId, setDiscordGuildId] = useState<string | null>(null);
  const [twitchChannel, setTwitchChannel] = useState<string | null>(null);
  const [lastMessageId, setLastMessageId] = useState<string | null>(null);

  const userInRoomRef = useMemoFirebase(() => {
    if (!firestore || !roomId || !user) return null;
    return doc(firestore, 'rooms', roomId, 'users', user.uid);
  }, [firestore, roomId, user]);

  const { data: firestoreUser } = useDoc<{ 
    discordGuildId?: string; 
    twitchChannel?: string; 
    discordSelectedChannel?: string;
    discordChannels?: DiscordChannel[];
  }>(userInRoomRef);

  if (!firestore || !user) {
    return (
      <DraggableContainer
        id={id}
        position={position}
        size={size}
        onPositionChange={onPositionChange}
        onSizeChange={onSizeChange}
        onClose={onClose}
        title="💬 Chat"
      >
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Loading...
        </div>
      </DraggableContainer>
    );
  }

  useEffect(() => {
    if (firestoreUser?.discordGuildId) {
      setDiscordGuildId(firestoreUser.discordGuildId);
    }
    if (firestoreUser?.twitchChannel) {
      setTwitchChannel(firestoreUser.twitchChannel);
    }
    if (firestoreUser?.discordSelectedChannel) {
      setSelectedChannel(firestoreUser.discordSelectedChannel);
    }
    if (firestoreUser?.discordChannels) {
      setDiscordChannels(firestoreUser.discordChannels);
    }
  }, [firestoreUser]);

  // No longer need to fetch channels - they're already in Firestore

  // Save selected channel to Firestore when it changes
  useEffect(() => {
    if (!selectedChannel || !userInRoomRef || !firestore) return;
    setDoc(userInRoomRef, { discordSelectedChannel: selectedChannel }, { merge: true }).catch(e => 
      console.error('Failed to save selected channel:', e)
    );
  }, [selectedChannel, userInRoomRef, firestore]);

  useEffect(() => {
    if (!selectedChannel) return;

    const pollMessages = async () => {
      try {
        const url = lastMessageId 
          ? `/api/discord/messages?channelId=${selectedChannel}&after=${lastMessageId}`
          : `/api/discord/messages?channelId=${selectedChannel}&limit=50`;
        
        const res = await fetch(url);
        const newMessages = await res.json();
        
        if (Array.isArray(newMessages) && newMessages.length > 0) {
          const msgs: ChatMessage[] = newMessages.reverse().map((msg: any) => ({
            id: msg.id,
            author: msg.author.username,
            content: msg.content,
            timestamp: new Date(msg.timestamp),
            platform: 'discord' as const,
          }));
          
          setMessages(prev => [...prev, ...msgs]);
          setLastMessageId(newMessages[newMessages.length - 1].id);
        }
      } catch (err) {
        console.error('Failed to poll messages:', err);
      }
    };

    pollMessages();
    const interval = setInterval(pollMessages, 3000);
    return () => clearInterval(interval);
  }, [selectedChannel, lastMessageId]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedChannel) return;
    
    try {
      await fetch('/api/discord/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: selectedChannel,
          content: newMessage,
        }),
      });
      setNewMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  return (
    <DraggableContainer
      id={id}
      position={position}
      size={size}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onClose={onClose}
      title="💬 Chat"
    >
      <div className="flex flex-col overflow-hidden flex-1">
        {/* Controls */}
        <div className="flex items-center gap-2 p-2 border-b bg-muted/30 flex-wrap">
          <Select value={selectedChannel} onValueChange={setSelectedChannel} disabled={loadingChannels || discordChannels.length === 0}>
            <SelectTrigger className="w-[140px] h-8">
              <SelectValue placeholder={loadingChannels ? 'Loading...' : discordChannels.length === 0 ? 'No channels' : 'Select channel'} />
            </SelectTrigger>
            <SelectContent>
              {discordChannels.map(ch => (
                <SelectItem key={ch.id} value={ch.id}>
                  {ch.type === 2 ? '🔊' : '#'} {ch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loadingChannels && <Loader2 className="h-4 w-4 animate-spin" />}

          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as any)}
            className="text-xs px-2 py-1 rounded border bg-background h-8"
          >
            <option value="tabbed">Tabbed</option>
            <option value="split-v">Split V</option>
            <option value="split-h">Split H</option>
          </select>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-hidden flex">
          {viewMode === 'tabbed' ? (
            <Tabs defaultValue="discord" className="w-full flex flex-col">
              <TabsList className="w-full rounded-none h-8">
                <TabsTrigger value="discord" className="text-xs flex-1">
                  Discord
                </TabsTrigger>
                <TabsTrigger value="twitch" className="text-xs flex-1">
                  Twitch
                </TabsTrigger>
              </TabsList>
              <TabsContent value="discord" className="flex-1 overflow-y-auto m-0 p-2">
                {!discordGuildId ? (
                  <div className="text-xs text-muted-foreground text-center py-4">
                    Set Discord server in your user card menu to view chat
                  </div>
                ) : (
                  <ChatMessageList messages={messages.filter((m) => m.platform === 'discord')} />
                )}
              </TabsContent>
              <TabsContent value="twitch" className="flex-1 m-0 p-0 overflow-hidden">
                {!twitchChannel ? (
                  <div className="text-xs text-muted-foreground text-center py-4">
                    Set Twitch channel in your user card menu to view chat
                  </div>
                ) : (
                  <iframe
                    src={`https://www.twitch.tv/embed/${twitchChannel}/chat?parent=${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}&darkpopout`}
                    className="w-full h-full border-0"
                  />
                )}
              </TabsContent>
            </Tabs>
          ) : viewMode === 'split-v' ? (
            <div className="flex gap-1 w-full">
              <div className="flex-1 overflow-y-auto border-r p-2">
                {!discordGuildId ? (
                  <div className="text-xs text-muted-foreground text-center py-4">
                    Set Discord server in your user card menu
                  </div>
                ) : (
                  <ChatMessageList messages={messages.filter((m) => m.platform === 'discord')} />
                )}
              </div>
              <div className="flex-1 p-0 overflow-hidden">
                {!twitchChannel ? (
                  <div className="text-xs text-muted-foreground text-center py-4">
                    Set Twitch channel in your user card menu
                  </div>
                ) : (
                  <iframe
                    src={`https://www.twitch.tv/embed/${twitchChannel}/chat?parent=${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}&darkpopout`}
                    className="w-full h-full border-0"
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1 w-full">
              <div className="flex-1 overflow-y-auto border-b p-2">
                {!discordGuildId ? (
                  <div className="text-xs text-muted-foreground text-center py-4">
                    Set Discord server in your user card menu
                  </div>
                ) : (
                  <ChatMessageList messages={messages.filter((m) => m.platform === 'discord')} />
                )}
              </div>
              <div className="flex-1 p-0 overflow-hidden">
                {!twitchChannel ? (
                  <div className="text-xs text-muted-foreground text-center py-4">
                    Set Twitch channel in your user card menu
                  </div>
                ) : (
                  <iframe
                    src={`https://www.twitch.tv/embed/${twitchChannel}/chat?parent=${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}&darkpopout`}
                    className="w-full h-full border-0"
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t p-2 bg-muted/30 flex gap-1">
          <Input
            placeholder={!discordGuildId ? "Set Discord server first..." : "Message..."}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            className="h-8 text-xs"
            disabled={!discordGuildId || !selectedChannel}
          />
          <Button
            size="sm"
            onClick={handleSendMessage}
            className="h-8 w-8 p-0"
            disabled={!discordGuildId || !selectedChannel}
          >
            <Send className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </DraggableContainer>
  );
}

function ChatMessageList({ messages }: { messages: ChatMessage[] }) {
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="space-y-1.5">
      {messages.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-4">
          No messages yet
        </div>
      ) : (
        messages.map((msg) => (
          <div key={msg.id} className="text-xs break-words">
            <div className="flex items-center gap-1">
              {msg.badge && (
                <span
                  className={`text-xs font-bold px-1 rounded ${
                    msg.badge === 'mod'
                      ? 'bg-red-500/20 text-red-700 dark:text-red-400'
                      : msg.badge === 'sub'
                        ? 'bg-purple-500/20 text-purple-700 dark:text-purple-400'
                        : 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                  }`}
                >
                  {msg.badge.toUpperCase()}
                </span>
              )}
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {msg.author}:
              </span>
            </div>
            <div className="text-muted-foreground ml-4">{msg.content}</div>
          </div>
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
