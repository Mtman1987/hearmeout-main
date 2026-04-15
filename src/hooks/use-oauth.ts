// Legacy OAuth hooks — now delegate to JWT session system
// Kept as stubs so nothing breaks if imported
'use client';

import { useSession } from './use-session';

export function useDiscordAuth() {
  const { user, isLoading, logout } = useSession();
  return {
    user: user?.discordId ? { id: user.discordId, username: user.displayName || '', avatar: user.photoURL || '' } : null,
    token: null,
    isLoading,
    isAuthenticated: !!user,
    logout,
  };
}

export function useTwitchAuth() {
  const { user, isLoading, logout } = useSession();
  return {
    user: user?.twitchId ? { id: user.twitchId, login: user.displayName || '', display_name: user.displayName || '', profile_image_url: user.photoURL || '' } : null,
    token: null,
    isLoading,
    isAuthenticated: !!user,
    logout,
  };
}
