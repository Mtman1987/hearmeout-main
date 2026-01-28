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
