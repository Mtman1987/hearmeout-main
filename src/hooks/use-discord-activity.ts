import { useEffect, useState } from 'react';

// Discord Activities SDK types
interface DiscordSDK {
  ready(): Promise<void>;
  authorize(options: { client_id: string; response_type: string; state: string; prompt: string; scope: string[] }): Promise<any>;
  authenticate(options: { access_token: string }): Promise<any>;
  setActivity(activity: any): Promise<void>;
  subscribe(event: string, callback: (data: any) => void): Promise<void>;
  unsubscribe(event: string, callback: (data: any) => void): Promise<void>;
  commands: {
    setActivity(activity: any): Promise<void>;
  };
}

declare global {
  interface Window {
    DiscordSDK?: DiscordSDK;
  }
}

export function useDiscordActivity() {
  const [discordSDK, setDiscordSDK] = useState<DiscordSDK | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initDiscordSDK = async () => {
      try {
        // Load Discord Activities SDK
        if (!window.DiscordSDK) {
          const script = document.createElement('script');
          script.src = 'https://discord.com/api/activities/sdk.js';
          script.onload = () => {
            if (window.DiscordSDK) {
              setDiscordSDK(window.DiscordSDK);
            }
          };
          document.head.appendChild(script);
          return;
        }

        const sdk = window.DiscordSDK;
        setDiscordSDK(sdk);

        // Initialize SDK
        await sdk.ready();
        setIsReady(true);

        // Authenticate user
        const { code } = await sdk.authorize({
          client_id: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID!,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify', 'guilds']
        });

        // Exchange code for user info via our DSH backend
        const response = await fetch('https://discord-stream-hub-new.fly.dev/api/discord/oauth/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, source: 'activity' })
        });

        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
          
          // Authenticate with Discord SDK
          await sdk.authenticate({ access_token: data.tokens.accessToken });
        }

      } catch (err) {
        console.error('Discord SDK initialization failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize Discord SDK');
      }
    };

    initDiscordSDK();
  }, []);

  const setActivity = async (activity: any) => {
    if (discordSDK && isReady) {
      try {
        await discordSDK.setActivity(activity);
      } catch (err) {
        console.error('Failed to set activity:', err);
      }
    }
  };

  const updateActivity = async (roomName: string, userCount: number, isPlaying: boolean, currentSong?: string) => {
    const activity = {
      type: 2, // LISTENING
      details: roomName,
      state: isPlaying && currentSong ? `🎵 ${currentSong}` : '🎧 Waiting for music',
      party: {
        size: [userCount, 50] // current users, max users
      },
      assets: {
        large_image: 'hearmeout_logo',
        large_text: 'HearMeOut - Live Music Streaming',
        small_image: isPlaying ? 'playing' : 'paused',
        small_text: isPlaying ? 'Playing' : 'Paused'
      },
      timestamps: isPlaying ? { start: Date.now() } : undefined,
      buttons: [
        {
          label: 'Join Room',
          url: `https://hearmeout-main.fly.dev/rooms/${roomName}`
        }
      ]
    };

    await setActivity(activity);
  };

  return {
    discordSDK,
    isReady,
    user,
    error,
    setActivity,
    updateActivity
  };
}