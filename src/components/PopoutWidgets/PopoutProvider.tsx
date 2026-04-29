'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';

export interface PopoutState {
  id: string;
  type: 'voice' | 'chat';
  isOpen: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  isDocked?: boolean;
  dockPosition?: 'top' | 'bottom' | 'left' | 'right';
  customSettings?: Record<string, any>;
}

interface PopoutContextType {
  popouts: PopoutState[];
  openPopout: (
    type: PopoutState['type'],
    initialSize?: { width: number; height: number }
  ) => void;
  closePopout: (id: string) => void;
  updatePopout: (id: string, updates: Partial<PopoutState>) => void;
  getPopout: (id: string) => PopoutState | undefined;
}

const PopoutContext = createContext<PopoutContextType | undefined>(undefined);

const STORAGE_KEY = 'hearmeout-popout-state';

export function PopoutProvider({ children }: { children: ReactNode }) {
  const [popouts, setPopouts] = useState<PopoutState[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setPopouts(parsed);
      } catch (e) {
        console.error('Failed to restore popout state:', e);
      }
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(popouts));
    }
  }, [popouts, isHydrated]);

  const openPopout = useCallback(
    (type: PopoutState['type'], initialSize = { width: 400, height: 300 }) => {
      const id = `${type}-${Date.now()}`;
      const newPopout: PopoutState = {
        id,
        type,
        isOpen: true,
        position: {
          x: Math.max(20, window.innerWidth - initialSize.width - 20),
          y: Math.max(20, window.innerHeight - initialSize.height - 20),
        },
        size: initialSize,
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
