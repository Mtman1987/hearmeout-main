# OAuth, Chat Integration & Deployment Guide

Complete guide for implementing Discord/Twitch OAuth, finishing chat features, and preparing for Firebase App Hosting.

---

## Phase 1: Discord Chat Integration

### Step 1.1: Discord Bot Setup

First, ensure your bot has proper permissions:

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application
3. Under "Bot", get your token (keep secret!)
4. Under "OAuth2" → "URL Generator", select:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Read Messages/View Channels`, `Send Messages`, `Read Message History`
5. Copy the generated URL and invite bot to your server

### Step 1.2: Update Discord Chat Service

```typescript
// src/lib/discord-chat-service.ts

import { Collection, TextChannel, Guild, Message } from 'discord.js';
import { db } from '@/firebase/admin';

export interface DiscordMessage {
  id: string;
  author: string;
  authorId: string;
  content: string;
  timestamp: Date;
  role?: 'bot' | 'owner' | 'mod' | 'user';
  avatarUrl?: string;
}

export class DiscordChatService {
  private static client: any = null;

  /**
   * Initialize Discord bot client
   */
  static async initialize(token: string) {
    const { Client, GatewayIntentBits } = await import('discord.js');
    
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    await this.client.login(token);
    console.log('Discord bot initialized');
  }

  /**
   * Get Discord guilds (servers) the bot has access to
   */
  static async getGuilds() {
    if (!this.client) throw new Error('Discord client not initialized');
    return this.client.guilds.cache.map((guild: Guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL(),
    }));
  }

  /**
   * Get channels in a guild
   */
  static async getChannels(guildId: string) {
    if (!this.client) throw new Error('Discord client not initialized');
    
    const guild = await this.client.guilds.fetch(guildId);
    const channels = [];

    for (const [_, channel] of guild.channels.cache) {
      if (channel.isTextBased()) {
        channels.push({
          id: channel.id,
          name: channel.name,
          type: 'text',
          parent: channel.parentId,
        });
      } else if (channel.isVoiceBased()) {
        channels.push({
          id: channel.id,
          name: channel.name,
          type: 'voice',
          parent: channel.parentId,
        });
      }
    }

    return channels;
  }

  /**
   * Get recent messages from a channel
   */
  static async getChannelMessages(
    guildId: string,
    channelId: string,
    limit: number = 50
  ): Promise<DiscordMessage[]> {
    if (!this.client) throw new Error('Discord client not initialized');

    const guild = await this.client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId) as TextChannel;
    
    if (!channel.isTextBased()) {
      throw new Error('Channel is not a text channel');
    }

    const messages = await channel.messages.fetch({ limit });
    
    return messages
      .reverse()
      .map((msg: Message) => ({
        id: msg.id,
        author: msg.author.username,
        authorId: msg.author.id,
        content: msg.content,
        timestamp: msg.createdAt,
        role: msg.author.bot ? 'bot' : 'user',
        avatarUrl: msg.author.displayAvatarURL(),
      }));
  }

  /**
   * Subscribe to channel messages in real-time
   */
  static subscribeToChannel(
    guildId: string,
    channelId: string,
    onMessage: (message: DiscordMessage) => void,
    onError: (error: Error) => void
  ): () => void {
    if (!this.client) throw new Error('Discord client not initialized');

    const messageHandler = async (msg: Message) => {
      // Ignore bot's own messages and messages from other channels
      if (msg.channelId !== channelId) return;
      if (msg.author.id === this.client.user.id) return;

      const discordMessage: DiscordMessage = {
        id: msg.id,
        author: msg.author.username,
        authorId: msg.author.id,
        content: msg.content,
        timestamp: msg.createdAt,
        role: msg.author.bot ? 'bot' : 'user',
        avatarUrl: msg.author.displayAvatarURL(),
      };

      onMessage(discordMessage);
    };

    const errorHandler = (error: Error) => {
      console.error('Discord message stream error:', error);
      onError(error);
    };

    this.client.on('messageCreate', messageHandler);
    this.client.on('error', errorHandler);

    // Return unsubscribe function
    return () => {
      this.client.off('messageCreate', messageHandler);
      this.client.off('error', errorHandler);
    };
  }

  /**
   * Send message to channel
   */
  static async sendMessage(
    guildId: string,
    channelId: string,
    content: string
  ): Promise<string> {
    if (!this.client) throw new Error('Discord client not initialized');

    const guild = await this.client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId) as TextChannel;
    
    if (!channel.isTextBased()) {
      throw new Error('Channel is not a text channel');
    }

    const msg = await channel.send(content);
    return msg.id;
  }
}
```

### Step 1.3: Update Discord Chat Widget

```typescript
// src/components/PopoutWidgets/ChatWidget.tsx (updated)

'use client';

import React, { useState, useEffect } from 'react';
import { DraggableContainer } from './DraggableContainer';
import { DiscordChatService } from '@/lib/discord-chat-service';
import { TwitchChatService } from '@/lib/twitch-chat-service';

interface DiscordMessage {
  id: string;
  author: string;
  content: string;
  timestamp: Date;
  role?: string;
  avatarUrl?: string;
}

interface TwitchMessage {
  id: string;
  username: string;
  message: string;
  timestamp: Date;
  badges?: Record<string, string>;
}

interface ChatWidgetProps {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onClose: () => void;
  roomId: string;
  guildId?: string;
  channelId?: string;
  twitchChannel?: string;
}

export function ChatWidget({
  id,
  position,
  size,
  onPositionChange,
  onSizeChange,
  onClose,
  roomId,
  guildId,
  channelId,
  twitchChannel,
}: ChatWidgetProps) {
  const [platform, setPlatform] = useState<'discord' | 'twitch'>('discord');
  const [viewMode, setViewMode] = useState<'tabbed' | 'split-v' | 'split-h'>('tabbed');
  const [discordMessages, setDiscordMessages] = useState<DiscordMessage[]>([]);
  const [twitchMessages, setTwitchMessages] = useState<TwitchMessage[]>([]);
  const [selectedChannel, setSelectedChannel] = useState(channelId);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);

  // Load initial Discord messages
  useEffect(() => {
    if (!guildId || !selectedChannel) return;

    const loadMessages = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/discord/messages?guildId=${guildId}&channelId=${selectedChannel}`
        );
        const data = await response.json();
        setDiscordMessages(data);
      } catch (error) {
        console.error('Error loading Discord messages:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMessages();

    // Subscribe to real-time messages
    const unsubscribe = subscribeToDiscordMessages(
      guildId,
      selectedChannel,
      (msg) => setDiscordMessages((prev) => [...prev, msg])
    );

    return unsubscribe;
  }, [guildId, selectedChannel]);

  // Load initial Twitch messages
  useEffect(() => {
    if (!twitchChannel) return;

    const loadMessages = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/twitch/chat?channel=${twitchChannel}`);
        const data = await response.json();
        setTwitchMessages(data);
      } catch (error) {
        console.error('Error loading Twitch messages:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMessages();

    // Subscribe to real-time messages
    const unsubscribe = subscribeToTwitchMessages(
      twitchChannel,
      (msg) => setTwitchMessages((prev) => [...prev, msg])
    );

    return unsubscribe;
  }, [twitchChannel]);

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    try {
      if (platform === 'discord' && guildId && selectedChannel) {
        await fetch('/api/discord/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guildId,
            channelId: selectedChannel,
            content: newMessage,
          }),
        });
      }
      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
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
          <select
            value={selectedChannel}
            onChange={(e) => setSelectedChannel(e.target.value)}
            className="text-xs px-2 py-1 rounded border bg-background h-8"
            disabled={!guildId}
          >
            <option value="">Select Channel...</option>
            {/* Channel options populated from API */}
          </select>

          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as any)}
            className="text-xs px-2 py-1 rounded border bg-background h-8 ml-auto"
          >
            <option value="tabbed">Tabbed</option>
            <option value="split-v">Split V</option>
            <option value="split-h">Split H</option>
          </select>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-hidden flex">
          {viewMode === 'tabbed' ? (
            <div className="w-full flex flex-col">
              <div className="flex gap-2 px-2 py-1 border-b">
                <button
                  onClick={() => setPlatform('discord')}
                  className={`px-3 py-1 text-xs rounded ${
                    platform === 'discord'
                      ? 'bg-blue-500 text-white'
                      : 'bg-muted'
                  }`}
                >
                  Discord
                </button>
                <button
                  onClick={() => setPlatform('twitch')}
                  className={`px-3 py-1 text-xs rounded ${
                    platform === 'twitch'
                      ? 'bg-purple-500 text-white'
                      : 'bg-muted'
                  }`}
                >
                  Twitch
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {platform === 'discord' ? (
                  <DiscordMessageList messages={discordMessages} loading={loading} />
                ) : (
                  <TwitchMessageList messages={twitchMessages} loading={loading} />
                )}
              </div>
            </div>
          ) : viewMode === 'split-v' ? (
            <div className="flex gap-1 w-full">
              <div className="flex-1 overflow-y-auto border-r p-2">
                <DiscordMessageList messages={discordMessages} loading={loading} />
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <TwitchMessageList messages={twitchMessages} loading={loading} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1 w-full">
              <div className="flex-1 overflow-y-auto border-b p-2">
                <DiscordMessageList messages={discordMessages} loading={loading} />
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <TwitchMessageList messages={twitchMessages} loading={loading} />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t p-2 bg-muted/30 flex gap-1">
          <input
            type="text"
            placeholder="Message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            className="flex-1 text-xs px-2 py-1 rounded border"
            disabled={platform === 'discord' && !selectedChannel}
          />
          <button
            onClick={handleSendMessage}
            className="px-3 py-1 text-xs bg-blue-500 text-white rounded"
          >
            Send
          </button>
        </div>
      </div>
    </DraggableContainer>
  );
}

function DiscordMessageList({
  messages,
  loading,
}: {
  messages: DiscordMessage[];
  loading: boolean;
}) {
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (loading) return <div className="text-xs text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-1.5 text-xs">
      {messages.length === 0 ? (
        <div className="text-muted-foreground text-center">No messages</div>
      ) : (
        messages.map((msg) => (
          <div key={msg.id} className="break-words">
            <div className="flex items-center gap-2">
              {msg.avatarUrl && (
                <img
                  src={msg.avatarUrl}
                  alt={msg.author}
                  className="w-5 h-5 rounded-full"
                />
              )}
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {msg.author}
              </span>
              {msg.role === 'bot' && (
                <span className="text-xs px-1 rounded bg-yellow-500/20">BOT</span>
              )}
            </div>
            <div className="text-muted-foreground ml-7">{msg.content}</div>
          </div>
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

function TwitchMessageList({
  messages,
  loading,
}: {
  messages: TwitchMessage[];
  loading: boolean;
}) {
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (loading) return <div className="text-xs text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-1.5 text-xs">
      {messages.length === 0 ? (
        <div className="text-muted-foreground text-center">No messages</div>
      ) : (
        messages.map((msg) => (
          <div key={msg.id} className="break-words">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-purple-600 dark:text-purple-400">
                {msg.username}
              </span>
              {msg.badges?.moderator && (
                <span className="text-xs px-1 rounded bg-red-500/20">MOD</span>
              )}
              {msg.badges?.subscriber && (
                <span className="text-xs px-1 rounded bg-purple-500/20">SUB</span>
              )}
            </div>
            <div className="text-muted-foreground ml-4">{msg.message}</div>
          </div>
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

function subscribeToDiscordMessages(
  guildId: string,
  channelId: string,
  onMessage: (msg: DiscordMessage) => void
): () => void {
  // TODO: Implement WebSocket subscription
  return () => {};
}

function subscribeToTwitchMessages(
  channel: string,
  onMessage: (msg: TwitchMessage) => void
): () => void {
  // TODO: Implement TMI.js subscription
  return () => {};
}
```

---

## Phase 2: Twitch Chat Integration

### Step 2.1: Install TMI.js

```bash
npm install tmi.js
npm install --save-dev @types/tmi.js
```

### Step 2.2: Update Twitch Chat Service

```typescript
// src/lib/twitch-chat-service.ts

import * as tmi from 'tmi.js';

export interface TwitchChatMessage {
  id: string;
  username: string;
  displayName: string;
  message: string;
  timestamp: Date;
  badges: {
    moderator?: boolean;
    subscriber?: boolean;
    vip?: boolean;
    bits?: string;
  };
  emotes?: string[];
}

export class TwitchChatService {
  private static client: tmi.Client | null = null;
  private static channels: Map<string, string> = new Map();

  /**
   * Initialize Twitch chat client
   */
  static async initialize(options: {
    username: string;
    token: string;
    channels?: string[];
  }) {
    this.client = new tmi.Client({
      options: { debug: false, messagesLogLevel: 'info' },
      connection: {
        secure: true,
        reconnect: true,
      },
      identity: {
        username: options.username,
        password: options.token,
      },
      channels: options.channels || [],
    });

    await this.client.connect();
    console.log('Twitch chat client initialized');
  }

  /**
   * Join a Twitch channel
   */
  static async joinChannel(channelName: string) {
    if (!this.client) throw new Error('Twitch client not initialized');

    try {
      await this.client.join(channelName);
      this.channels.set(channelName, channelName);
      console.log(`Joined Twitch channel: ${channelName}`);
    } catch (error) {
      console.error(`Error joining channel ${channelName}:`, error);
      throw error;
    }
  }

  /**
   * Leave a Twitch channel
   */
  static async leaveChannel(channelName: string) {
    if (!this.client) throw new Error('Twitch client not initialized');

    try {
      await this.client.part(channelName);
      this.channels.delete(channelName);
    } catch (error) {
      console.error(`Error leaving channel ${channelName}:`, error);
      throw error;
    }
  }

  /**
   * Subscribe to Twitch channel chat
   */
  static subscribeToChannel(
    channelName: string,
    onMessage: (message: TwitchChatMessage) => void,
    onError?: (error: Error) => void
  ): () => void {
    if (!this.client) throw new Error('Twitch client not initialized');

    const messageHandler = (channel: string, userstate: any, message: string) => {
      if (!message) return;

      const chatMessage: TwitchChatMessage = {
        id: userstate['msg-id'] || `${Date.now()}-${Math.random()}`,
        username: userstate.username,
        displayName: userstate['display-name'] || userstate.username,
        message,
        timestamp: new Date(),
        badges: {
          moderator: !!userstate.mod,
          subscriber: !!userstate.subscriber,
          vip: !!userstate.vip,
          bits: userstate.bits,
        },
        emotes: userstate.emotes ? parseEmotes(userstate.emotes) : undefined,
      };

      onMessage(chatMessage);
    };

    const errorHandler = (error: Error) => {
      console.error('Twitch chat error:', error);
      if (onError) onError(error);
    };

    this.client.on('message', messageHandler);
    this.client.on('disconnected', errorHandler);

    // Return unsubscribe function
    return () => {
      this.client?.removeListener('message', messageHandler);
      this.client?.removeListener('disconnected', errorHandler);
    };
  }

  /**
   * Send message to channel
   */
  static async sendMessage(channelName: string, message: string): Promise<void> {
    if (!this.client) throw new Error('Twitch client not initialized');

    try {
      await this.client.say(channelName, message);
    } catch (error) {
      console.error('Error sending Twitch message:', error);
      throw error;
    }
  }
}

function parseEmotes(emotesString: string): string[] {
  // Parse Twitch emote format
  return emotesString.split('/').map((emote) => emote.split(':')[0]);
}
```

---

## Phase 3: OAuth Setup

### Step 3.1: Discord OAuth

Create file: `src/app/api/auth/discord/callback/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', req.url));
  }

  try {
    // Exchange code for token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/discord/callback`,
        scope: 'identify email',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to get Discord token');
    }

    const { access_token, refresh_token } = await tokenResponse.json();

    // Get user info
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const user = await userResponse.json();

    // Store tokens in secure httpOnly cookie or session
    // Store in Secret Manager for production
    const response = NextResponse.redirect(
      new URL(`/rooms?discord_token=${access_token}`, req.url)
    );

    response.cookies.set('discord_token', access_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 604800, // 7 days
    });

    return response;
  } catch (error) {
    console.error('Discord OAuth error:', error);
    return NextResponse.redirect(
      new URL(`/login?error=${error instanceof Error ? error.message : 'unknown'}`, req.url)
    );
  }
}
```

### Step 3.2: Twitch OAuth

Create file: `src/app/api/auth/twitch/callback/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', req.url));
  }

  try {
    // Exchange code for token
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,
        client_secret: process.env.TWITCH_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/twitch/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to get Twitch token');
    }

    const { access_token, refresh_token } = await tokenResponse.json();

    // Get user info
    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,
        Authorization: `Bearer ${access_token}`,
      },
    });

    const { data: users } = await userResponse.json();
    const user = users[0];

    // Store tokens securely
    const response = NextResponse.redirect(
      new URL(`/rooms?twitch_token=${access_token}`, req.url)
    );

    response.cookies.set('twitch_token', access_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 604800,
    });

    return response;
  } catch (error) {
    console.error('Twitch OAuth error:', error);
    return NextResponse.redirect(
      new URL(`/login?error=${error instanceof Error ? error.message : 'unknown'}`, req.url)
    );
  }
}
```

### Step 3.3: Login Page with OAuth Buttons

Update: `src/app/login/page.tsx`

```typescript
'use client';

import { Button } from '@/components/ui/button';
import { useState } from 'react';

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);

  const handleDiscordLogin = () => {
    setIsLoading(true);
    const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/discord/callback`;
    const scopes = ['identify', 'email'].join(' ');
    
    const discordAuthUrl = new URL('https://discord.com/api/oauth2/authorize');
    discordAuthUrl.searchParams.set('client_id', clientId!);
    discordAuthUrl.searchParams.set('redirect_uri', redirectUri);
    discordAuthUrl.searchParams.set('response_type', 'code');
    discordAuthUrl.searchParams.set('scope', scopes);

    window.location.href = discordAuthUrl.toString();
  };

  const handleTwitchLogin = () => {
    setIsLoading(true);
    const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/twitch/callback`;
    const scopes = ['user:read:email', 'chat:read', 'chat:edit'].join(' ');

    const twitchAuthUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    twitchAuthUrl.searchParams.set('client_id', clientId!);
    twitchAuthUrl.searchParams.set('redirect_uri', redirectUri);
    twitchAuthUrl.searchParams.set('response_type', 'code');
    twitchAuthUrl.searchParams.set('scope', scopes);

    window.location.href = twitchAuthUrl.toString();
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full space-y-8 p-8">
        <h1 className="text-2xl font-bold text-center">HearMeOut</h1>

        <div className="space-y-4">
          <Button 
            onClick={handleDiscordLogin}
            disabled={isLoading}
            className="w-full"
          >
            Continue with Discord
          </Button>

          <Button 
            onClick={handleTwitchLogin}
            disabled={isLoading}
            variant="outline"
            className="w-full"
          >
            Continue with Twitch
          </Button>
        </div>
      </div>
    </div>
  );
}
```

---

## Phase 4: Environment Configuration

### Step 4.1: Update .env.local

```bash
# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# LiveKit
NEXT_PUBLIC_LIVEKIT_URL=https://your-livekit-server.com
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# Discord OAuth
NEXT_PUBLIC_DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_secret
NEXT_PUBLIC_DISCORD_BOT_TOKEN=your_bot_token

# Twitch OAuth
NEXT_PUBLIC_TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_secret

# Base URL
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

### Step 4.2: Create .env.production

```bash
# Will be set via Secret Manager in production
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
NEXT_PUBLIC_DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
NEXT_PUBLIC_DISCORD_BOT_TOKEN=
NEXT_PUBLIC_TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
NEXT_PUBLIC_BASE_URL=
```

---

## Phase 5: Google Secret Manager Setup

### Step 5.1: Create secrets in Google Cloud

```bash
gcloud secrets create discord-client-id --replication-policy="automatic" \
  --data-file=- <<< "your_discord_client_id"

gcloud secrets create discord-client-secret --replication-policy="automatic" \
  --data-file=- <<< "your_discord_secret"

gcloud secrets create twitch-client-id --replication-policy="automatic" \
  --data-file=- <<< "your_twitch_client_id"

gcloud secrets create twitch-client-secret --replication-policy="automatic" \
  --data-file=- <<< "your_twitch_secret"

# Add more for other sensitive values
```

### Step 5.2: Create apphosting.yaml configuration

```yaml
# apphosting.yaml
apiVersion: apphosting.cnrm.cloud.google.com/v1
kind: BackendConfig
metadata:
  name: hearmeout-backend
spec:
  # Environment variables loaded from Secret Manager
  environmentVariables:
    NEXT_PUBLIC_FIREBASE_API_KEY:
      secretKeyRef:
        name: firebase-api-key
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
      secretKeyRef:
        name: firebase-auth-domain
    NEXT_PUBLIC_FIREBASE_PROJECT_ID:
      secretKeyRef:
        name: firebase-project-id
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:
      secretKeyRef:
        name: firebase-storage-bucket
    NEXT_PUBLIC_LIVEKIT_URL:
      secretKeyRef:
        name: livekit-url
    LIVEKIT_API_KEY:
      secretKeyRef:
        name: livekit-api-key
    LIVEKIT_API_SECRET:
      secretKeyRef:
        name: livekit-api-secret
    NEXT_PUBLIC_DISCORD_CLIENT_ID:
      secretKeyRef:
        name: discord-client-id
    DISCORD_CLIENT_SECRET:
      secretKeyRef:
        name: discord-client-secret
    NEXT_PUBLIC_DISCORD_BOT_TOKEN:
      secretKeyRef:
        name: discord-bot-token
    NEXT_PUBLIC_TWITCH_CLIENT_ID:
      secretKeyRef:
        name: twitch-client-id
    TWITCH_CLIENT_SECRET:
      secretKeyRef:
        name: twitch-client-secret
    NEXT_PUBLIC_BASE_URL:
      secretKeyRef:
        name: base-url
```

### Step 5.3: Create runtime configuration

Create: `src/lib/secret-manager.ts`

```typescript
// For production, use Google Cloud Secret Manager
// In development, use environment variables

export class SecretManager {
  static async getSecret(secretName: string): Promise<string> {
    if (process.env.NODE_ENV === 'development') {
      // Use environment variables in development
      const envKey = secretNameToEnvKey(secretName);
      return process.env[envKey] || '';
    }

    // Use Google Cloud Secret Manager in production
    try {
      const secretManagerClient = new (await import(
        '@google-cloud/secret-manager'
      )).SecretManagerServiceClient();

      const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;

      const [version] = await secretManagerClient.accessSecretVersion({ name });
      const payload = version.payload?.data?.toString() || '';

      return payload;
    } catch (error) {
      console.error(`Error retrieving secret ${secretName}:`, error);
      throw error;
    }
  }
}

function secretNameToEnvKey(secretName: string): string {
  return secretName
    .toUpperCase()
    .replace(/-/g, '_');
}
```

---

## Phase 6: Firebase App Hosting Setup

### Step 6.1: apphosting.yaml for Firebase

Update root `apphosting.yaml`:

```yaml
runtime: nodejs
nodeVersion: "20"
env: flex

handlers:
  - url: ".*"
    script: auto

# Environment variables from Secret Manager
env_variables:
  NODE_ENV: "production"
  NEXT_PUBLIC_BASE_URL: "https://your-app.web.app"
```

### Step 6.2: firebase.json configuration

```json
{
  "hosting": {
    "public": ".next/static",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "run": {
          "serviceId": "hearmeout-backend",
          "region": "us-central1"
        }
      }
    ]
  },
  "apphosting": {
    "serviceId": "hearmeout-backend",
    "regions": ["us-central1"]
  }
}
```

### Step 6.3: Build configuration

Create: `.firebaserc`

```json
{
  "projects": {
    "default": "your-firebase-project-id"
  },
  "targets": {},
  "etags": {}
}
```

---

## Deployment Checklist

- [ ] Discord bot token added to Secret Manager
- [ ] Twitch API credentials added to Secret Manager
- [ ] Firebase credentials in Secret Manager
- [ ] LiveKit credentials in Secret Manager
- [ ] OAuth redirect URLs updated to production URL
- [ ] Discord redirect URI: `https://your-app.web.app/api/auth/discord/callback`
- [ ] Twitch redirect URI: `https://your-app.web.app/api/auth/twitch/callback`
- [ ] Environment variables configured in apphosting.yaml
- [ ] Firebase App Hosting backend configured
- [ ] Signin flow tested with OAuth
- [ ] Chat services initialized on app startup
- [ ] Rate limiting configured for API routes
- [ ] CORS headers configured correctly

---

## Troubleshooting

### OAuth Redirect Issues
- Ensure redirect URIs match exactly (including protocol and trailing slash)
- Check localhost vs production mismatch
- Verify NEXT_PUBLIC_BASE_URL is set correctly

### Discord Bot Permissions
- Bot needs `Read Messages/View Channels` + `Send Messages`
- Add bot to test server for development
- Verify intent bits in discord.js client

### Twitch Chat Connection
- Ensure TMI.js token is valid OAuth token (not API key)
- Scopes must include `chat:read` and `chat:edit`
- Test with CLI: `tmi-cli -u username -t token -c channel`

### Secret Manager Access
- Ensure service account has `Secret Accessor` role
- Verify secret names match env variable names
- Check Cloud Console for secret errors

---

This is a complete guide for implementing the chat features and preparing for deployment!
