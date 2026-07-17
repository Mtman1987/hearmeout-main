'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useSpmtAppState } from '@/hooks/use-spmt-app-state';

export interface PopoutState {
  id: string;
  type: 'voice' | 'chat' | 'queue' | 'addSong' | 'watch' | 'screenShare';
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
  savePopoutLayout: (id: string) => void;
  getPopout: (id: string) => PopoutState | undefined;
}

const PopoutContext = createContext<PopoutContextType | undefined>(undefined);
const SAVED_LAYOUTS_KEY = 'hearmeout-popout-saved-layouts:v1';

type SavedPopoutLayout = {
  position: PopoutState['position'];
  size: PopoutState['size'];
  opacity?: number;
};

function getScopeFromPath(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'rooms' && parts[1]) return `room:${parts[1]}`;
  if (parts[0] === 'overlay' && parts[1]) return `overlay:${parts[1]}`;
  return 'global';
}

function layoutKeyFor(type: PopoutState['type'], customSettings: Record<string, any> = {}) {
  const source = String(customSettings.source || type);
  return `${type}:${source}`;
}

function readLegacySavedLayouts(): Record<string, SavedPopoutLayout> {
  try {
    const raw = localStorage.getItem(SAVED_LAYOUTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function clampLayout(layout: SavedPopoutLayout): SavedPopoutLayout {
  const width = Math.max(250, Math.min(layout.size.width, Math.max(250, window.innerWidth - 20)));
  const height = Math.max(200, Math.min(layout.size.height, Math.max(200, window.innerHeight - 20)));
  return {
    position: {
      x: Math.max(0, Math.min(layout.position.x, Math.max(0, window.innerWidth - width))),
      y: Math.max(0, Math.min(layout.position.y, Math.max(0, window.innerHeight - height))),
    },
    size: { width, height },
    opacity: layout.opacity,
  };
}

export function PopoutProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const scope = getScopeFromPath(pathname || '/');
  const storageKey = `hearmeout-popout-state:${scope}`;
  const [popouts, setPopouts] = useState<PopoutState[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const persistedLayouts = useSpmtAppState('popout-layouts', { layouts: {} as Record<string, SavedPopoutLayout> });
  const [savedLayouts, setSavedLayouts] = useState<Record<string, SavedPopoutLayout>>({});

  useEffect(() => {
    if (!persistedLayouts.loaded) return;
    const legacy = readLegacySavedLayouts();
    const next = Object.keys(persistedLayouts.value.layouts || {}).length ? persistedLayouts.value.layouts : legacy;
    setSavedLayouts(next);
    if (persistedLayouts.accountBacked) localStorage.removeItem(SAVED_LAYOUTS_KEY);
    if (!Object.keys(persistedLayouts.value.layouts || {}).length && Object.keys(legacy).length) {
      void persistedLayouts.save({ layouts: legacy }).catch(() => {});
    }
  }, [persistedLayouts.loaded]);

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
      const savedLayout = savedLayouts[layoutKeyFor(type, customSettings)];
      const layout = savedLayout
        ? clampLayout(savedLayout)
        : {
            position: {
              x: Math.max(20, window.innerWidth - initialSize.width - 20),
              y: Math.max(20, window.innerHeight - initialSize.height - 20),
            },
            size: initialSize,
            opacity: 1,
          };
      const newPopout: PopoutState = {
        id,
        type,
        isOpen: true,
        position: layout.position,
        size: layout.size,
        opacity: layout.opacity ?? 1,
        customSettings,
      };
      setPopouts((prev) => [...prev, newPopout]);
    },
    [savedLayouts]
  );

  const closePopout = useCallback((id: string) => {
    setPopouts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const updatePopout = useCallback((id: string, updates: Partial<PopoutState>) => {
    setPopouts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
  }, []);

  const savePopoutLayout = useCallback((id: string) => {
    const popout = popouts.find((p) => p.id === id);
    if (!popout) return;

    const layouts = { ...savedLayouts };
    layouts[layoutKeyFor(popout.type, popout.customSettings)] = {
      position: popout.position,
      size: popout.size,
      opacity: popout.opacity,
    };
    setSavedLayouts(layouts);
    void persistedLayouts.save({ layouts }).catch(() => {});
  }, [popouts, savedLayouts, persistedLayouts.save]);

  const getPopout = useCallback((id: string) => {
    return popouts.find((p) => p.id === id);
  }, [popouts]);

  return (
    <PopoutContext.Provider
      value={{ popouts, openPopout, closePopout, updatePopout, savePopoutLayout, getPopout }}
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
