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
import { Send } from 'lucide-react';

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

export function ChatWidget({
  id,
  position,
  size,
  onPositionChange,
  onSizeChange,
  onClose,
  roomId,
}: ChatWidgetProps) {
  const [selectedChannel, setSelectedChannel] = useState('general');
  const [viewMode, setViewMode] = useState<'tabbed' | 'split-v' | 'split-h'>('tabbed');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');

  // Mock messages for demo
  useEffect(() => {
    const mockMessages: ChatMessage[] = [
      {
        id: '1',
        author: 'StreamViewer',
        content: 'Great stream!',
        timestamp: new Date(Date.now() - 60000),
        platform: 'discord',
        badge: undefined,
      },
      {
        id: '2',
        author: 'Moderator',
        content: 'Welcome everyone! Check the rules pinned.',
        timestamp: new Date(Date.now() - 45000),
        platform: 'discord',
        badge: 'mod',
      },
      {
        id: '3',
        author: 'TwitchViewer123',
        content: 'Following!',
        timestamp: new Date(Date.now() - 30000),
        platform: 'twitch',
        badge: 'sub',
      },
      {
        id: '4',
        author: 'ChatUser',
        content: 'Thanks for streaming!',
        timestamp: new Date(Date.now() - 15000),
        platform: 'discord',
      },
    ];
    setMessages(mockMessages);
  }, [selectedChannel]);

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    const message: ChatMessage = {
      id: Date.now().toString(),
      author: 'You',
      content: newMessage,
      timestamp: new Date(),
      platform: 'discord',
    };
    setMessages((prev) => [...prev, message]);
    setNewMessage('');
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
          <Select value={selectedChannel} onValueChange={setSelectedChannel}>
            <SelectTrigger className="w-[140px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">general</SelectItem>
              <SelectItem value="announcements">announcements</SelectItem>
              <SelectItem value="random">random</SelectItem>
            </SelectContent>
          </Select>

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
                <ChatMessageList
                  messages={messages.filter((m) => m.platform === 'discord')}
                />
              </TabsContent>
              <TabsContent value="twitch" className="flex-1 overflow-y-auto m-0 p-2">
                <ChatMessageList
                  messages={messages.filter((m) => m.platform === 'twitch')}
                />
              </TabsContent>
            </Tabs>
          ) : viewMode === 'split-v' ? (
            <div className="flex gap-1 w-full">
              <div className="flex-1 overflow-y-auto border-r p-2">
                <ChatMessageList
                  messages={messages.filter((m) => m.platform === 'discord')}
                />
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <ChatMessageList
                  messages={messages.filter((m) => m.platform === 'twitch')}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1 w-full">
              <div className="flex-1 overflow-y-auto border-b p-2">
                <ChatMessageList
                  messages={messages.filter((m) => m.platform === 'discord')}
                />
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <ChatMessageList
                  messages={messages.filter((m) => m.platform === 'twitch')}
                />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t p-2 bg-muted/30 flex gap-1">
          <Input
            placeholder="Message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            onClick={handleSendMessage}
            className="h-8 w-8 p-0"
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
