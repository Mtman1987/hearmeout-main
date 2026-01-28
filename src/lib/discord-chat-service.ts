export interface DiscordMessage {
  id: string;
  author: string;
  authorId: string;
  content: string;
  timestamp: Date;
  role?: 'bot' | 'owner' | 'mod' | 'user';
  avatarUrl?: string;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'category';
  parent?: string;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon?: string;
}

const DISCORD_API = 'https://discord.com/api/v10';

export class DiscordChatService {
  private static botToken: string = '';

  /**
   * Initialize with bot token
   */
  static initialize(token: string) {
    this.botToken = token;
    console.log('Discord chat service initialized');
  }

  /**
   * Get Discord guilds (servers) the bot has access to
   */
  static async getGuilds(): Promise<DiscordGuild[]> {
    if (!this.botToken) throw new Error('Discord bot token not set');

    try {
      const response = await fetch(`${DISCORD_API}/users/@me/guilds`, {
        headers: { Authorization: `Bot ${this.botToken}` },
      });

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.statusText}`);
      }

      const guilds = await response.json();
      return guilds.map((g: any) => ({
        id: g.id,
        name: g.name,
        icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : undefined,
      }));
    } catch (error) {
      console.error('Error fetching Discord guilds:', error);
      throw error;
    }
  }

  /**
   * Get channels in a guild
   */
  static async getChannels(guildId: string): Promise<DiscordChannel[]> {
    if (!this.botToken) throw new Error('Discord bot token not set');

    try {
      const response = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
        headers: { Authorization: `Bot ${this.botToken}` },
      });

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.statusText}`);
      }

      const channels = await response.json();
      return channels
        .filter((c: any) => c.type === 0 || c.type === 2) // 0 = text, 2 = voice
        .map((c: any) => ({
          id: c.id,
          name: c.name,
          type: c.type === 0 ? 'text' : 'voice',
          parent: c.parent_id,
        }));
    } catch (error) {
      console.error('Error fetching Discord channels:', error);
      throw error;
    }
  }

  /**
   * Get recent messages from a channel
   */
  static async getChannelMessages(
    channelId: string,
    limit: number = 50
  ): Promise<DiscordMessage[]> {
    if (!this.botToken) throw new Error('Discord bot token not set');

    try {
      const response = await fetch(
        `${DISCORD_API}/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`,
        {
          headers: { Authorization: `Bot ${this.botToken}` },
        }
      );

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.statusText}`);
      }

      const messages = await response.json();
      return messages
        .reverse()
        .map((m: any) => ({
          id: m.id,
          author: m.author.username,
          authorId: m.author.id,
          content: m.content,
          timestamp: new Date(m.timestamp),
          role: m.author.bot ? 'bot' : 'user',
          avatarUrl: m.author.avatar
            ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png`
            : undefined,
        }));
    } catch (error) {
      console.error('Error fetching Discord messages:', error);
      throw error;
    }
  }

  /**
   * Send message to channel
   */
  static async sendMessage(
    channelId: string,
    content: string
  ): Promise<string> {
    if (!this.botToken) throw new Error('Discord bot token not set');

    try {
      const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.statusText}`);
      }

      const message = await response.json();
      return message.id;
    } catch (error) {
      console.error('Error sending Discord message:', error);
      throw error;
    }
  }

  /**
   * Subscribe to channel messages via polling
   * Note: For production, use Discord webhooks or a bot with message event streaming
   */
  static subscribeToChannel(
    channelId: string,
    onMessage: (message: DiscordMessage) => void,
    onError: (error: Error) => void,
    pollIntervalMs: number = 5000
  ): () => void {
    if (!this.botToken) throw new Error('Discord bot token not set');

    let lastMessageId = '';
    let isRunning = true;

    const poll = async () => {
      try {
        const url = lastMessageId
          ? `${DISCORD_API}/channels/${channelId}/messages?after=${lastMessageId}&limit=10`
          : `${DISCORD_API}/channels/${channelId}/messages?limit=10`;

        const response = await fetch(url, {
          headers: { Authorization: `Bot ${this.botToken}` },
        });

        if (!response.ok) throw new Error(`Discord API error: ${response.statusText}`);

        const messages = await response.json();

        if (messages.length > 0) {
          // Process messages in chronological order
          for (const m of messages.reverse()) {
            if (m.author.id !== this.botToken) {
              onMessage({
                id: m.id,
                author: m.author.username,
                authorId: m.author.id,
                content: m.content,
                timestamp: new Date(m.timestamp),
                role: m.author.bot ? 'bot' : 'user',
                avatarUrl: m.author.avatar
                  ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png`
                  : undefined,
              });
            }
            lastMessageId = m.id;
          }
        }

        if (isRunning) {
          setTimeout(poll, pollIntervalMs);
        }
      } catch (error) {
        console.error('Discord polling error:', error);
        onError(error instanceof Error ? error : new Error(String(error)));
        if (isRunning) {
          setTimeout(poll, pollIntervalMs * 2); // Exponential backoff on error
        }
      }
    };

    // Start polling
    poll();

    // Return unsubscribe function
    return () => {
      isRunning = false;
    };
  }
}
