'use client';

import { useCallback, useEffect } from 'react';

export type VoiceMode = 'wakeWord';

interface UseVoiceControlsOptions {
  setMicEnabled: (enabled: boolean) => void | Promise<void>;
}

interface VoiceControlsState {
  mode: VoiceMode;
  setMode: (mode: VoiceMode) => void;
}

const STORAGE_KEY = 'hmo-voice-controls';

function persistWakeWordMode() {
  try {
    // This intentionally overwrites legacy open/PTT/gate settings. The room
    // microphone is now controlled only by the normal mute button; persona
    // activation is handled by explicit wake names in the worker.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'wakeWord' }));
  } catch {}
}

export function useVoiceControls({ setMicEnabled }: UseVoiceControlsOptions): VoiceControlsState {
  useEffect(() => {
    persistWakeWordMode();
  }, []);

  const setMode = useCallback((_mode: VoiceMode) => {
    persistWakeWordMode();
    void setMicEnabled(true);
  }, [setMicEnabled]);

  return { mode: 'wakeWord', setMode };
}
