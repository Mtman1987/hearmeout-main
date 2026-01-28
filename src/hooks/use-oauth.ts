'use client';

import { useEffect, useState } from 'react';

export interface DiscordUser {
  id: string;
  username: string;
  avatar?: string;
  email?: string;
}

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export function useDiscordAuth() {
  const [user, setUser] = useState<DiscordUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Get from cookies
    const cookieValue = document.cookie
      .split('; ')
      .find((row) => row.startsWith('discord_user='))
      ?.split('=')[1];

    const tokenValue = document.cookie
      .split('; ')
      .find((row) => row.startsWith('discord_access_token='))
      ?.split('=')[1];

    if (cookieValue) {
      try {
        setUser(JSON.parse(decodeURIComponent(cookieValue)));
      } catch (error) {
        console.error('Error parsing Discord user:', error);
      }
    }

    if (tokenValue) {
      setToken(decodeURIComponent(tokenValue));
    }

    setIsLoading(false);
  }, []);

  const logout = () => {
    // Clear cookies
    document.cookie = 'discord_access_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    document.cookie = 'discord_refresh_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    document.cookie = 'discord_user=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    setUser(null);
    setToken(null);
  };

  return { user, token, isLoading, isAuthenticated: !!user, logout };
}

export function useTwitchAuth() {
  const [user, setUser] = useState<TwitchUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Get from cookies
    const cookieValue = document.cookie
      .split('; ')
      .find((row) => row.startsWith('twitch_user='))
      ?.split('=')[1];

    const tokenValue = document.cookie
      .split('; ')
      .find((row) => row.startsWith('twitch_access_token='))
      ?.split('=')[1];

    if (cookieValue) {
      try {
        setUser(JSON.parse(decodeURIComponent(cookieValue)));
      } catch (error) {
        console.error('Error parsing Twitch user:', error);
      }
    }

    if (tokenValue) {
      setToken(decodeURIComponent(tokenValue));
    }

    setIsLoading(false);
  }, []);

  const logout = () => {
    // Clear cookies
    document.cookie = 'twitch_access_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    document.cookie = 'twitch_refresh_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    document.cookie = 'twitch_user=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    setUser(null);
    setToken(null);
  };

  return { user, token, isLoading, isAuthenticated: !!user, logout };
}
