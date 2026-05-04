'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { usePathname } from 'next/navigation';

export interface PopoutState {
  id: string;
  type: 'voice' | 'chat' | 'queue' | 'addSong';
  isOpen: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  opacity?: number;
  isDocked?: boolean;
  dockPosition?: 'top' | 'bottom' | 'left' | 'right';
  customSettings?: Record<string, any>;
}

interface PopoutContextType {
  popouts: PopoutState[];
  openPopout: (
    type: PopoutState['type'],
    initialSize?: { width: number; height: number },
    customSettings?: Record<string, any>
  ) => void;
  closePopout: (id: string) => void;
  updatePopout: (id: string, updates: Partial<PopoutState>) => void;
  getPopout: (id: string) => PopoutState | undefined;
}

const PopoutContext = createContext<PopoutContextType | undefined>(undefined);

function getScopeFromPath(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'rooms' && parts[1]) return `room:${parts[1]}`;
  if (parts[0] === 'overlay' && parts[1]) return `overlay:${parts[1]}`;
  return 'global';
}

export function PopoutProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const scope = getScopeFromPath(pathname || '/');
  const storageKey = `hearmeout-popout-state:${scope}`;
  const [popouts, setPopouts] = useState<PopoutState[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setPopouts(parsed);
      } catch (e) {
        console.error('Failed to restore popout state:', e);
        setPopouts([]);
      }
    } else {
      setPopouts([]);
    }
    setIsHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(storageKey, JSON.stringify(popouts));
    }
  }, [popouts, isHydrated, storageKey]);

  const openPopout = useCallback(
    (type: PopoutState['type'], initialSize = { width: 400, height: 300 }, customSettings: Record<string, any> = {}) => {
      const id = `${type}-${customSettings.source || 'widget'}-${Date.now()}`;
      const newPopout: PopoutState = {
        id,
        type,
        isOpen: true,
        position: {
          x: Math.max(20, window.innerWidth - initialSize.width - 20),
          y: Math.max(20, window.innerHeight - initialSize.height - 20),
        },
        size: initialSize,
        opacity: 1,
        customSettings,
      };
      setPopouts((prev) => [...prev, newPopout]);
    },
    []
  );

  const closePopout = useCallback((id: string) => {
    setPopouts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const updatePopout = useCallback((id: string, updates: Partial<PopoutState>) => {
    setPopouts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
  }, []);

  const getPopout = useCallback((id: string) => {
    return popouts.find((p) => p.id === id);
  }, [popouts]);

  return (
    <PopoutContext.Provider
      value={{ popouts, openPopout, closePopout, updatePopout, getPopout }}
    >
      {children}
    </PopoutContext.Provider>
  );
}

export function usePopout() {
  const context = useContext(PopoutContext);
  if (!context) {
    throw new Error('usePopout must be used within PopoutProvider');
  }
  return context;
}
