'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export interface SessionUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  discordId?: string;
  twitchId?: string;
  isAnonymous?: boolean;
  [key: string]: any;
}

interface SessionContextType {
  user: SessionUser | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/me');
      const data = await res.json();
      if (!data.user && process.env.NODE_ENV === 'development') {
        // Auto-login as guest in dev mode
        const guestRes = await fetch('/api/auth/guest', { method: 'POST' });
        if (guestRes.ok) {
          const retry = await fetch('/api/me');
          const retryData = await retry.json();
          setUser(retryData.user || null);
          return;
        }
      }
      setUser(data.user || null);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <SessionContext.Provider value={{ user, isLoading, refresh, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextType {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

export function useUser() {
  const { user, isLoading } = useSession();
  return { user, isUserLoading: isLoading };
}
