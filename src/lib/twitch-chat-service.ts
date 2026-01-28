import { TwitchChatMessage } from '@/types/chat';

export class TwitchChatService {
  private static readonly iframeBaseUrl = 'https://www.twitch.tv/embed';

  /**
   * Get embed iframe URL for Twitch chat
   * @param channelName - Twitch channel name
   * @param parentDomain - Parent domain for iframe security (your domain)
   */
  static getIframeUrl(channelName: string, parentDomain: string): string {
    const params = new URLSearchParams({
      parent: parentDomain,
    });
    return `${this.iframeBaseUrl}/${channelName}/chat?${params.toString()}`;
  }

  /**
   * Subscribe to Twitch chat messages
   * TODO: Use Twitch EventSub or TMI.js library
   */
  static subscribeToChat(
    channelName: string,
    onMessage: (message: TwitchChatMessage) => void
  ): () => void {
    // Return unsubscribe function
    return () => {};
  }

  /**
   * Get chat configuration for iframe embed
   */
  static getChatConfig(channelName: string) {
    return {
      width: '100%',
      height: '100%',
      layout: 'video-with-chat',
    };
  }
}
