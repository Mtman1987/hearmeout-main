'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export type VoiceMode = 'open' | 'pushToTalk' | 'noiseGate';

interface UseVoiceControlsOptions {
  // Function to mute/unmute the mic track
  setMicEnabled: (enabled: boolean) => void;
  // Current audio level (0-1) for noise gate
  audioLevel?: number;
}

interface VoiceControlsState {
  mode: VoiceMode;
  setMode: (mode: VoiceMode) => void;
  pttKey: string;
  setPttKey: (key: string) => void;
  noiseGateThreshold: number;
  setNoiseGateThreshold: (threshold: number) => void;
  noiseGateRelease: number;
  setNoiseGateRelease: (ms: number) => void;
  isPttActive: boolean;
  isGateOpen: boolean;
}

const STORAGE_KEY = 'hmo-voice-controls';

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { mode: 'open', pttKey: ' ', noiseGateThreshold: 0.015, noiseGateRelease: 250 };
}

function saveSettings(settings: { mode: VoiceMode; pttKey: string; noiseGateThreshold: number; noiseGateRelease: number }) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
}

export function useVoiceControls({ setMicEnabled, audioLevel = 0 }: UseVoiceControlsOptions): VoiceControlsState {
  const saved = useRef(loadSettings());
  const [mode, setModeState] = useState<VoiceMode>(saved.current.mode);
  const [pttKey, setPttKeyState] = useState<string>(saved.current.pttKey);
  const [noiseGateThreshold, setNoiseGateThresholdState] = useState<number>(saved.current.noiseGateThreshold);
  const [noiseGateRelease, setNoiseGateReleaseState] = useState<number>(saved.current.noiseGateRelease);
  const [isPttActive, setIsPttActive] = useState(false);
  const [isGateOpen, setIsGateOpen] = useState(false);

  const modeRef = useRef(mode);
  const pttKeyRef = useRef(pttKey);
  const thresholdRef = useRef(noiseGateThreshold);
  const releaseRef = useRef(noiseGateRelease);
  const gateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { pttKeyRef.current = pttKey; }, [pttKey]);
  useEffect(() => { thresholdRef.current = noiseGateThreshold; }, [noiseGateThreshold]);
  useEffect(() => { releaseRef.current = noiseGateRelease; }, [noiseGateRelease]);

  const setMode = useCallback((m: VoiceMode) => {
    setModeState(m);
    saveSettings({ mode: m, pttKey: pttKeyRef.current, noiseGateThreshold: thresholdRef.current, noiseGateRelease: releaseRef.current });
    // Reset state when switching modes
    if (m === 'open') setMicEnabled(true);
    if (m === 'pushToTalk') { setMicEnabled(false); setIsPttActive(false); }
    if (m === 'noiseGate') setIsGateOpen(false);
  }, [setMicEnabled]);

  const setPttKey = useCallback((key: string) => {
    setPttKeyState(key);
    saveSettings({ mode: modeRef.current, pttKey: key, noiseGateThreshold: thresholdRef.current, noiseGateRelease: releaseRef.current });
  }, []);

  const setNoiseGateThreshold = useCallback((t: number) => {
    setNoiseGateThresholdState(t);
    saveSettings({ mode: modeRef.current, pttKey: pttKeyRef.current, noiseGateThreshold: t, noiseGateRelease: releaseRef.current });
  }, []);

  const setNoiseGateRelease = useCallback((ms: number) => {
    setNoiseGateReleaseState(ms);
    saveSettings({ mode: modeRef.current, pttKey: pttKeyRef.current, noiseGateThreshold: thresholdRef.current, noiseGateRelease: ms });
  }, []);

  // --- Push to Talk ---
  useEffect(() => {
    if (mode !== 'pushToTalk') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // Ignore if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === pttKeyRef.current || e.code === pttKeyRef.current) {
        e.preventDefault();
        setIsPttActive(true);
        setMicEnabled(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === pttKeyRef.current || e.code === pttKeyRef.current) {
        setIsPttActive(false);
        setMicEnabled(false);
      }
    };

    // Also support mouse buttons for PTT
    const handleMouseDown = (e: MouseEvent) => {
      if (pttKeyRef.current === `Mouse${e.button}`) {
        setIsPttActive(true);
        setMicEnabled(true);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (pttKeyRef.current === `Mouse${e.button}`) {
        setIsPttActive(false);
        setMicEnabled(false);
      }
    };

    // Start muted
    setMicEnabled(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [mode, setMicEnabled]);

  // --- Noise Gate ---
  useEffect(() => {
    if (mode !== 'noiseGate') return;

    if (audioLevel >= thresholdRef.current) {
      // Audio above threshold — open gate
      if (gateTimeoutRef.current) {
        clearTimeout(gateTimeoutRef.current);
        gateTimeoutRef.current = null;
      }
      if (!isGateOpen) {
        setIsGateOpen(true);
        setMicEnabled(true);
      }
    } else {
      // Audio below threshold — start release timer
      if (isGateOpen && !gateTimeoutRef.current) {
        gateTimeoutRef.current = setTimeout(() => {
          setIsGateOpen(false);
          setMicEnabled(false);
          gateTimeoutRef.current = null;
        }, releaseRef.current);
      }
    }
  }, [audioLevel, mode, isGateOpen, setMicEnabled]);

  // Cleanup gate timeout
  useEffect(() => {
    return () => {
      if (gateTimeoutRef.current) clearTimeout(gateTimeoutRef.current);
    };
  }, []);

  return {
    mode, setMode,
    pttKey, setPttKey,
    noiseGateThreshold, setNoiseGateThreshold,
    noiseGateRelease, setNoiseGateRelease,
    isPttActive, isGateOpen,
  };
}
