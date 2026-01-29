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
import { doc, updateDoc, setDoc, getDoc } from 'firebase/firestore';
import { postToDiscord } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';

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
  avatarUrl?: string;
  attachments?: Array<{ url: string; proxy_url: string; content_type?: string }>;
  embeds?: Array<{ image?: { url: string }; thumbnail?: { url: string } }>;
  mentions?: Array<{ id: string; username: string }>;
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
  const { toast } = useToast();
  const [selectedChannel, setSelectedChannel] = useState('');
  const [viewMode, setViewMode] = useState<'tabbed' | 'split-v' | 'split-h'>('tabbed');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [discordGuildId, setDiscordGuildId] = useState<string | null>(null);
  const [twitchChannel, setTwitchChannel] = useState<string | null>(null);
  const [lastMessageId, setLastMessageId] = useState<string | null>(null);
  const [postingEmbed, setPostingEmbed] = useState(false);

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

  useEffect(() => {
    if (firestoreUser?.discordGuildId) {
      setDiscordGuildId(firestoreUser.discordGuildId);
      // Load channels when guild ID is available
      if (firestoreUser.discordChannels && firestoreUser.discordChannels.length > 0) {
        setDiscordChannels(firestoreUser.discordChannels);
      }
    }
    if (firestoreUser?.twitchChannel) {
      setTwitchChannel(firestoreUser.twitchChannel);
    }
    if (firestoreUser?.discordSelectedChannel) {
      setSelectedChannel(firestoreUser.discordSelectedChannel);
    }
  }, [firestoreUser]);

  useEffect(() => {
    if (!selectedChannel || !userInRoomRef || !firestore) return;
    
    // Reset messages and lastMessageId when channel changes
    setMessages([]);
    setLastMessageId(null);
    
    // Save selected channel (write only when changed)
    setDoc(userInRoomRef, { discordSelectedChannel: selectedChannel }, { merge: true }).catch(e => 
      console.error('Failed to save selected channel:', e)
    );
  }, [selectedChannel, userInRoomRef, firestore]);

  // Poll Discord messages every 5 seconds
  useEffect(() => {
    if (!selectedChannel) return;

    const pollMessages = async () => {
      try {
        const url = lastMessageId 
          ? `/api/discord/messages?channelId=${selectedChannel}&after=${lastMessageId}`
          : `/api/discord/messages?channelId=${selectedChannel}&limit=50`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch messages');
        
        const newMessages = await res.json();
        
        if (Array.isArray(newMessages) && newMessages.length > 0) {
          const msgs: ChatMessage[] = newMessages.reverse().map((msg: any) => ({
            id: msg.id,
            author: msg.author.username,
            content: msg.content,
            timestamp: new Date(msg.timestamp),
            platform: 'discord' as const,
            avatarUrl: msg.author.avatar 
              ? `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png`
              : undefined,
            attachments: msg.attachments,
            embeds: msg.embeds,
            mentions: msg.mentions,
          }));
          
          setMessages(prev => [...prev, ...msgs]);
          setLastMessageId(newMessages[newMessages.length - 1].id);
        }
      } catch (err) {
        console.error('Failed to poll messages:', err);
      }
    };

    // Initial load
    pollMessages();
    
    // Poll every 5 seconds
    const interval = setInterval(pollMessages, 5000);
    return () => clearInterval(interval);
  }, [selectedChannel, lastMessageId]);

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



  const handlePostToDiscord = async () => {
    if (!selectedChannel) {
      toast({ variant: 'destructive', title: 'No Channel Selected', description: 'Select a Discord channel first.' });
      return;
    }
    
    setPostingEmbed(true);
    try {
      // Fetch room data to get custom links
      const roomRef = doc(firestore!, 'rooms', roomId);
      const roomSnap = await getDoc(roomRef);
      const roomData = roomSnap.data();
      
      await postToDiscord(
        selectedChannel,
        roomId,
        roomData?.name || 'Music Room',
        roomData?.description || 'Join us for music and chat!',
        roomData?.link1Label,
        roomData?.link1Url,
        roomData?.link2Label,
        roomData?.link2Url
      );
      toast({ title: 'Posted to Discord!', description: 'Control embed sent to selected channel' });
    } catch (error: any) {
      console.error('Failed to post embed:', error);
      toast({ variant: 'destructive', title: 'Discord Error', description: error.message || 'Could not post to Discord.' });
    } finally {
      setPostingEmbed(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedChannel) return;
    
    const messageText = newMessage;
    setNewMessage(''); // Clear input immediately
    
    try {
      const res = await fetch('/api/discord/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: selectedChannel,
          content: messageText,
          username: user?.displayName || 'HearMeOut User',
          avatarUrl: user?.photoURL,
        }),
      });
      
      if (!res.ok) throw new Error('Failed to send message');
      
      // Immediately add message to local state for instant feedback
      const sentMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        author: user?.displayName || 'You',
        content: messageText,
        timestamp: new Date(),
        platform: 'discord',
        avatarUrl: user?.photoURL,
      };
      setMessages(prev => [...prev, sentMsg]);
      
      // Reset lastMessageId to force refresh on next poll
      setLastMessageId(null);
    } catch (error) {
      console.error('Failed to send message:', error);
      setNewMessage(messageText); // Restore message on error
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
          
          <Button 
            size="sm" 
            onClick={handlePostToDiscord}
            disabled={!selectedChannel || postingEmbed}
            className="h-8 text-xs"
          >
            {postingEmbed ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <svg className="h-3 w-3 mr-1" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16.29 5.23a10.08 10.08 0 0 0-2.2-.62.84.84 0 0 0-1 .75c.18.25.36.5.52.75a8.62 8.62 0 0 0-4.14 0c.16-.25.34-.5.52-.75a.84.84 0 0 0-1-.75 10.08 10.08 0 0 0-2.2.62.81.81 0 0 0-.54.78c-.28 3.24.78 6.28 2.82 8.25a.85.85 0 0 0 .93.12 7.55 7.55 0 0 0 1.45-.87.82.82 0 0 1 .9-.06 6.53 6.53 0 0 0 2.22 0 .82.82 0 0 1 .9.06 7.55 7.55 0 0 0 1.45.87.85.85 0 0 0 .93-.12c2.04-1.97 3.1-5 2.82-8.25a.81.81 0 0 0-.55-.78zM10 11.85a1.45 1.45 0 0 1-1.45-1.45A1.45 1.45 0 0 1 10 8.95a1.45 1.45 0 0 1 1.45 1.45A1.45 1.45 0 0 1 10 11.85zm4 0a1.45 1.45 0 0 1-1.45-1.45A1.45 1.45 0 0 1 14 8.95a1.45 1.45 0 0 1 1.45 1.45A1.45 1.45 0 0 1 14 11.85z"/>
                </svg>
                Post Embed
              </>
            )}
          </Button>
          
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
        <div className="flex-1 overflow-hidden flex flex-col">
          {viewMode === 'tabbed' ? (
            <Tabs defaultValue="discord" className="w-full flex flex-col flex-1">
              <TabsList className="w-full rounded-none h-8 flex-shrink-0">
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
            <div className="flex gap-1 w-full flex-1">
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-2">
                  {!discordGuildId ? (
                    <div className="text-xs text-muted-foreground text-center py-4">
                      Set Discord server in your user card menu
                    </div>
                  ) : (
                    <ChatMessageList messages={messages.filter((m) => m.platform === 'discord')} />
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
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
            <div className="flex flex-col gap-1 w-full flex-1">
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-2">
                  {!discordGuildId ? (
                    <div className="text-xs text-muted-foreground text-center py-4">
                      Set Discord server in your user card menu
                    </div>
                  ) : (
                    <ChatMessageList messages={messages.filter((m) => m.platform === 'discord')} />
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
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

        {/* Input - Only show for Discord */}
        {discordGuildId && (
          <div className="border-t p-2 bg-muted/30 flex gap-1 flex-shrink-0">
            <Input
              placeholder="Message..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              className="h-8 text-xs"
              disabled={!selectedChannel}
            />
            <Button
              size="sm"
              onClick={handleSendMessage}
              className="h-8 w-8 p-0"
              disabled={!selectedChannel}
            >
              <Send className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
    </DraggableContainer>
  );
}

function ChatMessageList({ messages }: { messages: ChatMessage[] }) {
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const parseDiscordContent = (content: string, mentions?: Array<{ id: string; username: string }>) => {
    let parsed = content;
    
    // Replace user mentions
    if (mentions) {
      mentions.forEach(mention => {
        parsed = parsed.replace(new RegExp(`<@!?${mention.id}>`, 'g'), `@${mention.username}`);
      });
    }
    
    // Replace custom emojis with their names
    parsed = parsed.replace(/<a?:(\w+):\d+>/g, ':$1:');
    
    return parsed;
  };

  return (
    <div className="space-y-2">
      {messages.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-4">
          No messages yet
        </div>
      ) : (
        messages.map((msg) => (
          <div key={msg.id} className="text-xs break-words flex gap-2">
            {msg.avatarUrl && (
              <img 
                src={msg.avatarUrl} 
                alt={msg.author} 
                className="w-6 h-6 rounded-full flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 flex-wrap">
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
                  {msg.author}
                </span>
              </div>
              {msg.content && (
                <div className="text-foreground mt-0.5">
                  {parseDiscordContent(msg.content, msg.mentions)}
                </div>
              )}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="mt-1 space-y-1">
                  {msg.attachments.map((att, i) => (
                    att.content_type?.startsWith('image/') ? (
                      <img 
                        key={i}
                        src={att.proxy_url || att.url} 
                        alt="attachment" 
                        className="max-w-full max-h-48 rounded"
                      />
                    ) : (
                      <a 
                        key={i}
                        href={att.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline block"
                      >
                        📎 Attachment
                      </a>
                    )
                  ))}
                </div>
              )}
              {msg.embeds && msg.embeds.length > 0 && (
                <div className="mt-1 space-y-1">
                  {msg.embeds.map((embed, i) => (
                    (embed.image?.url || embed.thumbnail?.url) && (
                      <img 
                        key={i}
                        src={embed.image?.url || embed.thumbnail?.url} 
                        alt="embed" 
                        className="max-w-full max-h-48 rounded"
                      />
                    )
                  ))}
                </div>
              )}
            </div>
          </div>
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
