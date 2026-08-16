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
const SESSION_CACHE_KEY = 'spmt.cache.v1.hearmeout.session';

type CachedSessionEnvelope = {
  version: 1;
  savedAt: string;
  user: SessionUser;
};

function readCachedUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = JSON.parse(localStorage.getItem(SESSION_CACHE_KEY) || 'null') as CachedSessionEnvelope | null;
    if (!cached || cached.version !== 1 || !cached.user?.uid) return null;
    return cached.user;
  } catch {
    return null;
  }
}

function writeCachedUser(user: SessionUser) {
  try {
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      user,
    } satisfies CachedSessionEnvelope));
  } catch {}
}

function clearCachedUser() {
  try { localStorage.removeItem(SESSION_CACHE_KEY); } catch {}
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const initialUser = typeof window !== 'undefined' ? readCachedUser() : null;
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [isLoading, setIsLoading] = useState(!initialUser);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/me', { cache: 'no-store', credentials: 'include' });
      if (!res.ok) {
        // Keep the last-known shell during an upstream auth/network outage. The
        // protected APIs still enforce the authoritative server session.
        return;
      }

      const data = await res.json();
      if (!data.user && process.env.NODE_ENV === 'development') {
        const guestRes = await fetch('/api/auth/guest', { method: 'POST' });
        if (guestRes.ok) {
          const retry = await fetch('/api/me', { cache: 'no-store', credentials: 'include' });
          const retryData = retry.ok ? await retry.json() : null;
          if (retryData?.user) {
            writeCachedUser(retryData.user);
            setUser(retryData.user);
          }
          return;
        }
      }

      if (data.user) {
        writeCachedUser(data.user);
        setUser(data.user);
      } else {
        clearCachedUser();
        setUser(null);
      }
    } catch {
      // A transient failure must not replace a usable cached shell with sign-in.
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    clearCachedUser();
    setUser(null);
    setIsLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

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
