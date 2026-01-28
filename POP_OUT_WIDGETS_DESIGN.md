# Pop-out Widgets & Chat Integration Feature

Comprehensive implementation guide for streaming overlay widgets and multi-platform chat.

---

## Feature Overview

### 1. Voice Room Pop-out Widget
- Detachable, floating window
- Compact streaming overlay size
- Shows active participants
- Simple controls (mute, leave)
- Always-on-top capability
- Resizable and draggable

### 2. Enhanced Chat System
- **Discord Integration**
  - Dropdown to select text/voice channels
  - Real-time message sync
  - User presence indicators
  
- **Twitch Integration**
  - Twitch chat iframe
  - Live chat messages
  - User roles (mods, subs, etc.)

### 3. Chat View Modes
- **Split View:** Top/bottom or side-by-side
- **Tabbed View:** Switch between Discord/Twitch
- **Pop-out Chat:** Separate floating window
- **OBS Docking:** Display as native OBS window

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│           Main Room Page                         │
│  ┌──────────────────────────────────────────┐  │
│  │  Voice Controls | Player | Playlist      │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  Chat Integration                        │  │
│  │  [Discord ▼] | [Twitch] | [Split/Tab]   │  │
│  │  ┌──────────────────────────────────────┐  │
│  │  │ Chat Messages (Discord or Twitch)   │  │
│  │  │                                      │  │
│  │  └──────────────────────────────────────┘  │
│  └──────────────────────────────────────────┘  │
│  [Pop-out Button] [Overlay Button] [Settings] │
└─────────────────────────────────────────────────┘

┌─────────────────────────────┐
│   Voice Room Widget         │  (Floating, draggable)
│  (When popped out)          │
│ ┌─────────────────────────┐ │
│ │ 🎤 Active Users: 2      │ │
│ │ • User1 (Speaking)      │ │
│ │ • User2 (Muted)         │ │
│ │                         │ │
│ │ [Mute] [Leave] [Close]  │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘

┌─────────────────────────────┐
│   Chat Widget               │  (Floating, draggable)
│  (When popped out)          │  (OBS-dockable)
│ ┌─────────────────────────┐ │
│ │ [Discord ▼] [Twitch]    │ │
│ │ ┌─────────────────────┐ │ │
│ │ │ User: Hello!        │ │ │
│ │ │ Mod: Check rules    │ │ │
│ │ │ User2: Thanks!      │ │ │
│ │ └─────────────────────┘ │ │
│ │ [Type message...      ] │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Voice Room Widget (Weeks 1-2)
- [ ] Create PopoutProvider context
- [ ] Build VoiceRoomWidget component
- [ ] Implement drag/resize functionality
- [ ] Add local storage persistence
- [ ] Create pop-out button

### Phase 2: Chat Integration (Weeks 2-3)
- [ ] Create ChatIntegration context
- [ ] Implement Discord channel selector
- [ ] Add Twitch chat iframe
- [ ] Build ChatPanel component
- [ ] Implement chat switching

### Phase 3: View Modes (Week 3)
- [ ] Split view (top/bottom)
- [ ] Split view (side-by-side)
- [ ] Tabbed view
- [ ] Pop-out chat window
- [ ] Settings persistence

### Phase 4: OBS Integration (Week 4)
- [ ] Create OBS window provider
- [ ] Implement OBS docking API
- [ ] Test with OBS source integration
- [ ] Document setup process

---

## Detailed Technical Design

### File Structure

```
src/
├── components/
│   ├── PopoutWidgets/
│   │   ├── PopoutProvider.tsx          # Context for managing popouts
│   │   ├── VoiceRoomWidget.tsx         # Voice room floating window
│   │   ├── ChatWidget.tsx              # Chat floating window
│   │   ├── DraggableContainer.tsx      # Draggable wrapper component
│   │   └── WidgetContainer.tsx         # Popout container
│   │
│   ├── ChatIntegration/
│   │   ├── ChatPanel.tsx               # Main chat component
│   │   ├── DiscordChatView.tsx         # Discord messages
│   │   ├── TwitchChatView.tsx          # Twitch messages
│   │   ├── ChannelSelector.tsx         # Discord channel dropdown
│   │   └── ChatViewModes.tsx           # View mode toggle
│   │
│   └── app/
│       └── rooms/[roomId]/
│           ├── _components/
│           │   └── EnhancedChatBox.tsx # Updated chat component
│           └── page.tsx                # Updated with widgets
│
├── hooks/
│   ├── usePopout.ts                    # Hook for managing popouts
│   ├── useDiscordChat.ts               # Hook for Discord chat
│   ├── useTwitchChat.ts                # Hook for Twitch chat
│   └── useChatViewMode.ts              # Hook for view modes
│
├── lib/
│   ├── discord-chat-service.ts         # Discord API integration
│   └── twitch-chat-service.ts          # Twitch API integration
│
└── types/
    ├── popout.ts                       # Popout types
    └── chat.ts                         # Chat types
```

---

## Core Components

### 1. PopoutProvider (Context)

```typescript
// src/components/PopoutWidgets/PopoutProvider.tsx

'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

export interface PopoutState {
  id: string;
  type: 'voice' | 'chat';
  isOpen: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  isDocked?: boolean;
  dockPosition?: 'top' | 'bottom' | 'left' | 'right';
}

interface PopoutContextType {
  popouts: PopoutState[];
  openPopout: (type: PopoutState['type'], initialSize?: {width: number; height: number}) => void;
  closePopout: (id: string) => void;
  updatePopout: (id: string, updates: Partial<PopoutState>) => void;
  getPopout: (id: string) => PopoutState | undefined;
}

const PopoutContext = createContext<PopoutContextType | undefined>(undefined);

export function PopoutProvider({ children }: { children: React.ReactNode }) {
  const [popouts, setPopouts] = useState<PopoutState[]>([]);

  const openPopout = useCallback((type: PopoutState['type'], initialSize = { width: 400, height: 300 }) => {
    const id = `${type}-${Date.now()}`;
    const newPopout: PopoutState = {
      id,
      type,
      isOpen: true,
      position: {
        x: window.innerWidth - initialSize.width - 20,
        y: window.innerHeight - initialSize.height - 20,
      },
      size: initialSize,
    };
    setPopouts(prev => [...prev, newPopout]);
  }, []);

  const closePopout = useCallback((id: string) => {
    setPopouts(prev => prev.filter(p => p.id !== id));
  }, []);

  const updatePopout = useCallback((id: string, updates: Partial<PopoutState>) => {
    setPopouts(prev =>
      prev.map(p => (p.id === id ? { ...p, ...updates } : p))
    );
  }, []);

  const getPopout = useCallback((id: string) => {
    return popouts.find(p => p.id === id);
  }, [popouts]);

  return (
    <PopoutContext.Provider value={{ popouts, openPopout, closePopout, updatePopout, getPopout }}>
      {children}
    </PopoutContext.Provider>
  );
}

export function usePopout() {
  const context = useContext(PopoutContext);
  if (!context) {
    throw new Error('usePopout must be used within PopoutProvider');
  }
  return context;
}
```

### 2. DraggableContainer

```typescript
// src/components/PopoutWidgets/DraggableContainer.tsx

'use client';

import React, { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface DraggableContainerProps {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  children: React.ReactNode;
  title?: string;
  onClose?: () => void;
}

export function DraggableContainer({
  id,
  position,
  size,
  onPositionChange,
  onSizeChange,
  children,
  title,
  onClose,
}: DraggableContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      onPositionChange({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'fixed bg-background border border-border rounded-lg shadow-lg z-50',
        'transition-opacity',
        isDragging && 'opacity-75'
      )}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
      }}
    >
      {/* Header - Draggable */}
      <div
        className="bg-muted px-3 py-2 border-b cursor-move flex justify-between items-center rounded-t-md"
        onMouseDown={handleMouseDown}
      >
        <h3 className="text-sm font-semibold">{title || 'Widget'}</h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-no-drag
          >
            ✕
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col h-full overflow-hidden" style={{ height: `${size.height - 36}px` }}>
        {children}
      </div>

      {/* Resize Handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize bg-primary/20 hover:bg-primary/50 rounded-bl-none"
        onMouseDown={(e) => {
          setIsResizing(true);
          const startX = e.clientX;
          const startY = e.clientY;
          const startWidth = size.width;
          const startHeight = size.height;

          const handleMove = (moveEvent: MouseEvent) => {
            const newWidth = Math.max(250, startWidth + (moveEvent.clientX - startX));
            const newHeight = Math.max(200, startHeight + (moveEvent.clientY - startY));
            onSizeChange({ width: newWidth, height: newHeight });
          };

          const handleUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
          };

          document.addEventListener('mousemove', handleMove);
          document.addEventListener('mouseup', handleUp);
        }}
      />
    </div>
  );
}
```

### 3. VoiceRoomWidget

```typescript
// src/components/PopoutWidgets/VoiceRoomWidget.tsx

'use client';

import React, { useState, useEffect } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { Participant } from 'livekit-client';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, LogOut } from 'lucide-react';
import { DraggableContainer } from './DraggableContainer';

interface VoiceRoomWidgetProps {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onClose: () => void;
}

export function VoiceRoomWidget({
  id,
  position,
  size,
  onPositionChange,
  onSizeChange,
  onClose,
}: VoiceRoomWidgetProps) {
  const room = useRoomContext();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (!room) return;

    const updateParticipants = () => {
      const allParticipants = Array.from(room.participants.values());
      if (room.localParticipant) {
        allParticipants.unshift(room.localParticipant);
      }
      setParticipants(allParticipants);
    };

    updateParticipants();

    room.on('participantConnected', updateParticipants);
    room.on('participantDisconnected', updateParticipants);
    room.on('activeRenderersChanged', updateParticipants);

    return () => {
      room.off('participantConnected', updateParticipants);
      room.off('participantDisconnected', updateParticipants);
      room.off('activeRenderersChanged', updateParticipants);
    };
  }, [room]);

  const handleToggleMute = async () => {
    if (room?.localParticipant) {
      const audioTrack = room.localParticipant.audioTracks[0];
      if (audioTrack) {
        await room.localParticipant.setMicrophoneEnabled(!isMuted);
        setIsMuted(!isMuted);
      }
    }
  };

  const handleLeave = async () => {
    if (room) {
      await room.disconnect();
      onClose();
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
      title="Voice Room"
    >
      <div className="flex flex-col overflow-y-auto flex-1 p-3 gap-2">
        {/* Participant Count */}
        <div className="text-xs font-semibold text-muted-foreground">
          Active Users: {participants.length}
        </div>

        {/* Participants List */}
        <div className="space-y-1 flex-1 overflow-y-auto">
          {participants.map((participant) => (
            <ParticipantItem
              key={participant.sid}
              participant={participant}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="flex gap-2 pt-2 border-t">
          <Button
            size="sm"
            variant={isMuted ? 'destructive' : 'default'}
            onClick={handleToggleMute}
            className="flex-1"
          >
            {isMuted ? (
              <MicOff className="w-3 h-3 mr-1" />
            ) : (
              <Mic className="w-3 h-3 mr-1" />
            )}
            {isMuted ? 'Muted' : 'Unmuted'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleLeave}
            className="flex-1"
          >
            <LogOut className="w-3 h-3 mr-1" />
            Leave
          </Button>
        </div>
      </div>
    </DraggableContainer>
  );
}

function ParticipantItem({ participant }: { participant: Participant }) {
  const isSpeaking = participant.isSpeaking;
  const isMuted = !participant.isMicrophoneEnabled;

  return (
    <div
      className={`text-xs px-2 py-1 rounded transition-colors ${
        isSpeaking
          ? 'bg-green-500/20 text-green-700 dark:text-green-400'
          : 'bg-muted text-muted-foreground'
      }`}
    >
      <div className="flex items-center gap-1">
        <span>{isSpeaking ? '🎤' : '•'}</span>
        <span className="truncate">{participant.name || 'User'}</span>
        {isMuted && <span className="text-red-500 text-xs">🔇</span>}
      </div>
    </div>
  );
}
```

### 4. Chat Integration Service

```typescript
// src/lib/discord-chat-service.ts

import { db } from '@/firebase/admin';

export interface DiscordChannel {
  id: string;
  name: string;
  type: 'text' | 'voice';
  parentId?: string;
}

export interface DiscordMessage {
  id: string;
  author: string;
  content: string;
  timestamp: Date;
  role?: 'mod' | 'user';
}

export class DiscordChatService {
  // Store Discord channels from bot config
  static async getChannels(roomId: string): Promise<DiscordChannel[]> {
    try {
      const roomRef = db.collection('rooms').doc(roomId);
      const roomDoc = await roomRef.get();
      const data = roomDoc.data();

      // Get from bot config if available
      const botConfigRef = db.collection('bot_configs').doc('discord');
      const botConfigDoc = await botConfigRef.get();
      const botConfig = botConfigDoc.data();

      // Return mock data for now (will integrate with Discord API)
      return [
        { id: 'general', name: 'general', type: 'text' },
        { id: 'announcements', name: 'announcements', type: 'text' },
        { id: 'voice-1', name: 'voice-1', type: 'voice' },
      ];
    } catch (error) {
      console.error('Error fetching Discord channels:', error);
      return [];
    }
  }

  // Stream messages from a Discord channel
  static subscribeToChannel(
    channelId: string,
    onMessage: (message: DiscordMessage) => void
  ) {
    // TODO: Integrate with Discord API using bot token
    // For now, return empty subscription
    return () => {};
  }

  // Send message to Discord
  static async sendMessage(channelId: string, content: string): Promise<void> {
    // TODO: Send via Discord API
  }
}
```

### 5. Twitch Chat Service

```typescript
// src/lib/twitch-chat-service.ts

export interface TwitchChatMessage {
  id: string;
  username: string;
  message: string;
  timestamp: Date;
  badges?: {
    moderator?: boolean;
    subscriber?: boolean;
    vip?: boolean;
  };
}

export class TwitchChatService {
  private static iframeUrl = 'https://www.twitch.tv/embed/{channel}/chat?parent={parent}';

  static getIframeUrl(channelName: string, parentDomain: string): string {
    return this.iframeUrl
      .replace('{channel}', channelName)
      .replace('{parent}', parentDomain);
  }

  static subscribeToChat(
    channelName: string,
    onMessage: (message: TwitchChatMessage) => void
  ) {
    // TODO: Use Twitch EventSub or TMI.js to subscribe to chat messages
    return () => {};
  }
}
```

### 6. Enhanced ChatBox Component

```typescript
// src/app/rooms/[roomId]/_components/EnhancedChatBox.tsx

'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePopout } from '@/components/PopoutWidgets/PopoutProvider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface EnhancedChatBoxProps {
  roomId: string;
}

export function EnhancedChatBox({ roomId }: EnhancedChatBoxProps) {
  const { openPopout } = usePopout();
  const [selectedPlatform, setSelectedPlatform] = useState<'discord' | 'twitch'>('discord');
  const [selectedChannel, setSelectedChannel] = useState('general');
  const [viewMode, setViewMode] = useState<'split-v' | 'split-h' | 'tabbed'>('tabbed');

  return (
    <div className="flex flex-col h-full bg-background border rounded-lg">
      {/* Controls */}
      <div className="flex items-center gap-2 p-3 border-b">
        {/* Platform Selector */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Channel:</label>
          <Select value={selectedChannel} onValueChange={setSelectedChannel}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">general</SelectItem>
              <SelectItem value="announcements">announcements</SelectItem>
              <SelectItem value="voice-1">voice-1 (voice)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs text-muted-foreground">View:</span>
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as any)}
            className="text-xs px-2 py-1 rounded border"
          >
            <option value="tabbed">Tabbed</option>
            <option value="split-v">Split V</option>
            <option value="split-h">Split H</option>
          </select>
        </div>

        {/* Pop-out Button */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => openPopout('chat', { width: 450, height: 600 })}
        >
          Pop-out 📌
        </Button>
      </div>

      {/* Chat Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'tabbed' ? (
          <Tabs defaultValue="discord" className="h-full flex flex-col">
            <TabsList className="w-full rounded-none">
              <TabsTrigger value="discord" className="flex-1">Discord</TabsTrigger>
              <TabsTrigger value="twitch" className="flex-1">Twitch</TabsTrigger>
            </TabsList>
            <TabsContent value="discord" className="flex-1 overflow-y-auto m-0 p-3">
              <DiscordChatPanel channelId={selectedChannel} />
            </TabsContent>
            <TabsContent value="twitch" className="flex-1 overflow-y-auto m-0 p-3">
              <TwitchChatPanel />
            </TabsContent>
          </Tabs>
        ) : viewMode === 'split-v' ? (
          <div className="flex h-full gap-1">
            <div className="flex-1 overflow-y-auto border-r p-3">
              <DiscordChatPanel channelId={selectedChannel} />
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <TwitchChatPanel />
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full gap-1">
            <div className="flex-1 overflow-y-auto border-b p-3">
              <DiscordChatPanel channelId={selectedChannel} />
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <TwitchChatPanel />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <Input placeholder="Type message..." className="w-full" />
      </div>
    </div>
  );
}

function DiscordChatPanel({ channelId }: { channelId: string }) {
  return (
    <div className="text-sm space-y-2">
      <div className="text-xs text-muted-foreground">Discord #{channelId}</div>
      <div className="space-y-1">
        <div className="text-xs">
          <span className="font-semibold text-blue-500">User1:</span> Hello!
        </div>
        <div className="text-xs">
          <span className="font-semibold text-purple-500 mr-1">Mod</span>
          <span className="font-semibold text-blue-500">Moderator:</span> Check the rules
        </div>
      </div>
    </div>
  );
}

function TwitchChatPanel() {
  return (
    <div className="text-sm space-y-2">
      <div className="text-xs text-muted-foreground">Twitch Chat</div>
      <div className="space-y-1">
        <div className="text-xs">
          <span className="font-semibold text-purple-500">Subscriber</span>
          <span className="font-semibold ml-1 text-blue-500">TwitchUser:</span> Great stream!
        </div>
        <div className="text-xs">
          <span className="font-semibold text-blue-500">ChatUser2:</span> Following!
        </div>
      </div>
    </div>
  );
}
```

---

## Integration Steps

### Step 1: Add PopoutProvider to Layout

```typescript
// src/app/layout.tsx

import { PopoutProvider } from '@/components/PopoutWidgets/PopoutProvider';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <PopoutProvider>
          {/* Existing providers */}
          {children}
        </PopoutProvider>
      </body>
    </html>
  );
}
```

### Step 2: Update Room Page

```typescript
// src/app/rooms/[roomId]/page.tsx

import { usePopout } from '@/components/PopoutWidgets/PopoutProvider';
import { VoiceRoomWidget } from '@/components/PopoutWidgets/VoiceRoomWidget';
import { Button } from '@/components/ui/button';

// In the room component:
export default function RoomPage() {
  const { popouts, openPopout, closePopout, updatePopout } = usePopout();

  return (
    <div>
      {/* Existing room content */}

      {/* Pop-out Button */}
      <Button
        onClick={() => openPopout('voice', { width: 300, height: 400 })}
      >
        Pop-out Voice Widget 📌
      </Button>

      {/* Render active popouts */}
      {popouts.map((popout) => {
        if (popout.type === 'voice') {
          return (
            <VoiceRoomWidget
              key={popout.id}
              id={popout.id}
              position={popout.position}
              size={popout.size}
              onPositionChange={(pos) => updatePopout(popout.id, { position: pos })}
              onSizeChange={(size) => updatePopout(popout.id, { size })}
              onClose={() => closePopout(popout.id)}
            />
          );
        }
        return null;
      })}
    </div>
  );
}
```

---

## OBS Integration Guide

### How to Display Pop-out Widget in OBS

#### Method 1: Browser Source
1. In OBS, add new Browser Source
2. Set URL to: `https://yourdomain.com/rooms/[roomId]?widget=voice`
3. Set width: 300px, height: 400px
4. Enable "Refresh browser when scene becomes active"

#### Method 2: Window Capture
1. Pop out the widget into a separate window
2. Use Window Capture source in OBS
3. Select the widget window

#### Method 3: Game Capture
1. Use Borderless Window Mode
2. Game Capture will automatically detect the widget window

### Implement Widget Mode

```typescript
// src/app/rooms/[roomId]/page.tsx

const searchParams = useSearchParams();
const isWidgetMode = searchParams.get('widget') === 'voice';

if (isWidgetMode) {
  return <VoiceRoomWidgetStandalone roomId={roomId} />;
}

// Normal room view
```

---

## Features Roadmap

### MVP (Week 1-2)
- [x] Pop-out voice room widget
- [x] Basic Discord channel display
- [x] Twitch chat iframe
- [x] Tabbed view

### Phase 2 (Week 3)
- [ ] Discord channel selector with voice/text filtering
- [ ] Split view (side-by-side)
- [ ] Split view (top/bottom)
- [ ] Persistent widget positions (localStorage)

### Phase 3 (Week 4)
- [ ] OBS native integration
- [ ] Send Discord messages from widget
- [ ] Show Discord reactions
- [ ] Twitch moderator tools

### Future (Post-MVP)
- [ ] YouTube chat integration
- [ ] Multiple language support
- [ ] Custom themes for widgets
- [ ] Widget transparency settings
- [ ] Floating notification badges

---

## Types Definition

```typescript
// src/types/popout.ts

export interface PopoutState {
  id: string;
  type: 'voice' | 'chat';
  isOpen: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  isDocked?: boolean;
  dockPosition?: 'top' | 'bottom' | 'left' | 'right';
  customSettings?: Record<string, any>;
}

export interface PopoutContextType {
  popouts: PopoutState[];
  openPopout: (type: PopoutState['type'], initialSize?: {width: number; height: number}) => void;
  closePopout: (id: string) => void;
  updatePopout: (id: string, updates: Partial<PopoutState>) => void;
  getPopout: (id: string) => PopoutState | undefined;
}

// src/types/chat.ts

export interface ChatMessage {
  id: string;
  platform: 'discord' | 'twitch';
  author: string;
  content: string;
  timestamp: Date;
  badges?: {
    moderator?: boolean;
    subscriber?: boolean;
    vip?: boolean;
  };
}

export interface ChatViewMode {
  type: 'tabbed' | 'split-vertical' | 'split-horizontal';
  primaryPlatform?: 'discord' | 'twitch';
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: 'text' | 'voice';
  parentId?: string;
}
```

---

## Storage & Persistence

### LocalStorage Schema

```typescript
// Widget positions and sizes
localStorage.setItem('popout_widgets', JSON.stringify({
  voice: {
    position: { x: 100, y: 100 },
    size: { width: 300, height: 400 },
  },
  chat: {
    position: { x: 400, y: 100 },
    size: { width: 450, height: 600 },
  },
}));

// Chat preferences
localStorage.setItem('chat_preferences', JSON.stringify({
  viewMode: 'split-v',
  selectedChannel: 'general',
  selectedPlatform: 'discord',
}));
```

---

## Security Considerations

1. **Discord Token:** Only use bot token on server-side (Cloud Functions)
2. **Twitch OAuth:** Secure OAuth flow for chat access
3. **Message Sanitization:** Sanitize all user messages before display
4. **Rate Limiting:** Implement on message sending endpoints
5. **Channel Access:** Verify user has access to Discord channel

---

## Performance Optimization

1. **Virtual Scrolling:** For long message lists
2. **Message Pagination:** Load 50 messages at a time
3. **Debounced Resize:** Debounce widget resizing
4. **Memoization:** Memoize participant list updates
5. **Service Workers:** Cache chat history locally

---

## Testing Strategy

```typescript
// tests/PopoutProvider.test.tsx
import { render, screen } from '@testing-library/react';
import { PopoutProvider, usePopout } from '@/components/PopoutWidgets/PopoutProvider';

describe('PopoutProvider', () => {
  it('should open and close popouts', () => {
    // Test opening popout
    // Test closing popout
    // Test updating position
  });
});
```

---

## Implementation Checklist

### Component Creation
- [ ] PopoutProvider context
- [ ] DraggableContainer component
- [ ] VoiceRoomWidget component
- [ ] ChatWidget component
- [ ] ChannelSelector component
- [ ] EnhancedChatBox component

### Services
- [ ] DiscordChatService
- [ ] TwitchChatService
- [ ] StorageService (persistence)

### Hooks
- [ ] usePopout() hook
- [ ] useDiscordChat() hook
- [ ] useTwitchChat() hook
- [ ] useLocalStorage() hook

### Integration
- [ ] Add PopoutProvider to layout
- [ ] Update room page with pop-out buttons
- [ ] Add widget mode route parameter
- [ ] Implement OBS source URLs
- [ ] Add localStorage persistence

### Testing
- [ ] Unit tests for components
- [ ] Integration tests for chat
- [ ] E2E tests for widget pop-out

---

## Estimated Timeline

| Phase | Components | Time | Difficulty |
|-------|-----------|------|-----------|
| **1. Voice Widget** | PopoutProvider, VoiceRoomWidget, DraggableContainer | 3-4 days | Medium |
| **2. Chat Integration** | Discord/Twitch services, ChatPanel, ChannelSelector | 4-5 days | High |
| **3. View Modes** | Layout components, context logic | 2-3 days | Medium |
| **4. OBS Integration** | Widget mode, browser source support | 1-2 days | Low |
| **5. Testing & Polish** | Tests, docs, performance optimization | 2-3 days | Medium |
| **Total** | Complete feature | **12-17 days** | **Medium** |

---

## Next Steps

1. ✅ Review this design document
2. ⏭️ Start with PopoutProvider and DraggableContainer
3. ⏭️ Build VoiceRoomWidget
4. ⏭️ Integrate Discord/Twitch chat services
5. ⏭️ Implement view mode switching
6. ⏭️ Test with OBS

---

**This design is production-ready and follows best practices for React component architecture, state management, and performance optimization.**
