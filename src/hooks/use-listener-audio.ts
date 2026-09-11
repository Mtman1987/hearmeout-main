'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { LISTENER_AUDIO_EVENT, LISTENER_AUDIO_PREFIX, parseListenerAudio, readListenerAudioSnapshot, writeListenerAudio } from '@/lib/listener-audio';

export function useListenerAudio(kind: string) {
  const subscribe = useCallback((notify: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === LISTENER_AUDIO_PREFIX + kind) notify();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(LISTENER_AUDIO_EVENT, notify);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(LISTENER_AUDIO_EVENT, notify);
    };
  }, [kind]);
  const snapshot = useSyncExternalStore(subscribe, useCallback(() => readListenerAudioSnapshot(kind), [kind]), () => null);
  const value = useMemo(() => parseListenerAudio(snapshot, kind.startsWith('voice:') ? 1 : 0.85), [snapshot, kind]);
  const setVolume = useCallback((volume: number) => writeListenerAudio(kind, { volume }), [kind]);
  return { ...value, setVolume };
}
