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
  color?: string;
  emotes?: Record<string, string[]>;
}

export class TwitchChatService {
  private static tmiClient: any = null;
  private static connectedChannels: Set<string> = new Set();

  /**
   * Initialize Twitch chat client with OAuth token
   * Requires scopes: chat:read chat:edit
   */
  static async initialize(options: {
    username: string;
    token: string;
    clientId: string;
  }) {
    try {
      // Dynamically import TMI.js (installed separately)
      const tmi = await import('tmi.js');

      this.tmiClient = new tmi.Client({
        options: {
          debug: false,
          messagesLogLevel: 'info',
        },
        connection: {
          secure: true,
          reconnect: true,
        },
        identity: {
          username: options.username,
          password: `oauth:${options.token}`,
        },
        channels: [],
      });

      await this.tmiClient.connect();
      console.log('Twitch chat client initialized');
    } catch (error) {
      if (error instanceof Error && error.message.includes('Cannot find module')) {
        console.warn('TMI.js not installed. Install with: npm install tmi.js');
      }
      throw error;
    }
  }

  /**
   * Join a Twitch channel chat
   */
  static async joinChannel(channelName: string): Promise<void> {
    if (!this.tmiClient) {
      throw new Error('Twitch client not initialized');
    }

    try {
      const normalizedName = channelName.toLowerCase();
      if (!this.connectedChannels.has(normalizedName)) {
        await this.tmiClient.join(normalizedName);
        this.connectedChannels.add(normalizedName);
        console.log(`Joined Twitch channel: ${normalizedName}`);
      }
    } catch (error) {
      console.error(`Error joining Twitch channel ${channelName}:`, error);
      throw error;
    }
  }

  /**
   * Leave a Twitch channel
   */
  static async leaveChannel(channelName: string): Promise<void> {
    if (!this.tmiClient) {
      throw new Error('Twitch client not initialized');
    }

    try {
      const normalizedName = channelName.toLowerCase();
      await this.tmiClient.part(normalizedName);
      this.connectedChannels.delete(normalizedName);
      console.log(`Left Twitch channel: ${normalizedName}`);
    } catch (error) {
      console.error(`Error leaving Twitch channel ${channelName}:`, error);
      throw error;
    }
  }

  /**
   * Subscribe to real-time chat messages from a channel
   */
  static subscribeToChannel(
    channelName: string,
    onMessage: (message: TwitchChatMessage) => void,
    onError?: (error: Error) => void
  ): () => void {
    if (!this.tmiClient) {
      throw new Error('Twitch client not initialized');
    }

    const normalizedName = channelName.toLowerCase();
    let unsubscribed = false;

    const messageHandler = (channel: string, userstate: any, message: string, self: boolean) => {
      // Ignore bot's own messages
      if (self) return;
      if (unsubscribed) return;

      // Parse badges
      const badges = {
        moderator: userstate.mod || false,
        subscriber: userstate.subscriber || false,
        vip: userstate.badges?.vip ? true : false,
        bits: userstate.bits || undefined,
      };

      // Parse emotes
      const emotes: Record<string, string[]> = {};
      if (userstate.emotes) {
        for (const emoteId in userstate.emotes) {
          emotes[emoteId] = userstate.emotes[emoteId];
        }
      }

      const chatMessage: TwitchChatMessage = {
        id: `${userstate['user-id']}-${Date.now()}`,
        username: userstate.username,
        displayName: userstate['display-name'] || userstate.username,
        message,
        timestamp: new Date(),
        badges,
        color: userstate.color || undefined,
        emotes: Object.keys(emotes).length > 0 ? emotes : undefined,
      };

      onMessage(chatMessage);
    };

    const errorHandler = (error: Error) => {
      console.error('Twitch chat error:', error);
      if (onError && !unsubscribed) {
        onError(error);
      }
    };

    // Attach listeners
    this.tmiClient.on('message', messageHandler);
    this.tmiClient.on('disconnected', errorHandler);

    // Return unsubscribe function
    return () => {
      unsubscribed = true;
      this.tmiClient?.removeListener('message', messageHandler);
      this.tmiClient?.removeListener('disconnected', errorHandler);
    };
  }

  /**
   * Send message to Twitch channel
   */
  static async sendMessage(channelName: string, message: string): Promise<void> {
    if (!this.tmiClient) {
      throw new Error('Twitch client not initialized');
    }

    try {
      const normalizedName = channelName.toLowerCase();
      if (!this.connectedChannels.has(normalizedName)) {
        await this.joinChannel(normalizedName);
      }
      await this.tmiClient.say(normalizedName, message);
    } catch (error) {
      console.error('Error sending Twitch message:', error);
      throw error;
    }
  }

  /**
   * Get Twitch chat iframe URL for embedded chat
   */
  static getIframeUrl(channelName: string, parentDomain: string): string {
    return `https://www.twitch.tv/embed/${channelName}/chat?parent=${parentDomain}&darkpixel=on`;
  }

  /**
   * Check if connected to a channel
   */
  static isConnected(channelName: string): boolean {
    return this.connectedChannels.has(channelName.toLowerCase());
  }

  /**
   * Get list of connected channels
   */
  static getConnectedChannels(): string[] {
    return Array.from(this.connectedChannels);
  }

  /**
   * Disconnect client
   */
  static async disconnect(): Promise<void> {
    if (this.tmiClient) {
      await this.tmiClient.disconnect();
      this.connectedChannels.clear();
      console.log('Twitch chat client disconnected');
    }
  }
}
