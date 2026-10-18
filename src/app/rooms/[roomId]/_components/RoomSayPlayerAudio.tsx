'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type SayItem = { id: number; audioUrl: string; personaId: string };

async function readRoomQueue(roomId: string, personaId: string, cursor?: number, latest = false) {
  const params = new URLSearchParams({ roomId, personaId });
  if (latest) params.set('latest', '1');
  else params.set('after', String(Math.max(0, cursor || 0)));
  const response = await fetch(`/api/rooms/persona-speech?${params.toString()}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(String(payload?.error || 'Room speech queue is unavailable'));
  }
  return payload as { latestId?: number; items?: Array<{ id?: number; audioUrl?: string }>; remaining?: number };
}

function clampVolume(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.8;
}

export default function RoomSayPlayerAudio({ roomId, personaIds, volumeByPersona, onUserGestureReady }: { roomId: string; personaIds: string[]; volumeByPersona: Record<string, number>; onUserGestureReady?: (resume: () => void) => void }) {
  const idsKey = Array.from(new Set(personaIds.map((id) => String(id || '').trim()).filter(Boolean))).join('\n');
  const ids = idsKey ? idsKey.split('\n') : [];
  const [enabled, setEnabled] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState('Connecting bot audio listener…');
  const cursorsRef = useRef<Map<string, number>>(new Map());
  const seenRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<SayItem[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);
  const blockedRef = useRef(false);
  const enabledRef = useRef(false);
  const volumeByPersonaRef = useRef(volumeByPersona);
  const activePersonaIdRef = useRef<string | null>(null);
  const autoStartedKeyRef = useRef('');
  const activeIdsRef = useRef<Set<string>>(new Set(ids));
  const playNextRef = useRef<() => void>(() => {});

  enabledRef.current = enabled;
  volumeByPersonaRef.current = volumeByPersona;
  activeIdsRef.current = new Set(ids);

  const playNext = () => {
    if (!enabledRef.current || blockedRef.current || playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    if (!activeIdsRef.current.has(next.personaId)) {
      cursorsRef.current.set(next.personaId, Math.max(cursorsRef.current.get(next.personaId) || 0, next.id));
      queueMicrotask(() => playNextRef.current());
      return;
    }

    playingRef.current = true;
    let settled = false;
    const audio = new Audio(next.audioUrl);
    audio.preload = 'auto';
    audio.volume = clampVolume(volumeByPersonaRef.current[next.personaId] ?? 0.8);
    audioRef.current = audio;
    activePersonaIdRef.current = next.personaId;

    const finish = (failed: boolean) => {
      if (settled) return;
      settled = true;
      cursorsRef.current.set(next.personaId, Math.max(cursorsRef.current.get(next.personaId) || 0, next.id));
      playingRef.current = false;
      if (audioRef.current === audio) audioRef.current = null;
      if (activePersonaIdRef.current === next.personaId) activePersonaIdRef.current = null;
      audio.pause();
      if (failed) setStatus('A bot reply audio file failed. Still listening for the next reply.');
      else setStatus('Bot audio enabled · listening for replies.');
      queueMicrotask(() => playNextRef.current());
    };

    audio.onended = () => finish(false);
    audio.onerror = () => finish(true);
    void audio.play().catch(() => {
      if (settled) return;
      settled = true;
      playingRef.current = false;
      if (audioRef.current === audio) audioRef.current = null;
      if (activePersonaIdRef.current === next.personaId) activePersonaIdRef.current = null;
      queueRef.current.unshift(next);
      blockedRef.current = true;
      setStatus("Playback was blocked; use this bot's volume control to resume.");
    });
    setStatus('Speaking…');
  };
  playNextRef.current = playNext;

  const enableOrResume = useCallback(async () => {
    if (connecting) return;
    const currentIds = idsKey ? idsKey.split('\n') : [];
    if (enabledRef.current) {
      if (blockedRef.current) {
        blockedRef.current = false;
        setStatus('Resuming bot audio…');
        // Called directly from the user click so the browser can grant playback.
        playNextRef.current();
      }
      return;
    }

    if (!currentIds.length) {
      setStatus('No invited bot is available for speech in this room.');
      return;
    }
    setConnecting(true);
    setStatus('Connecting the room audio listener…');
    try {
      const initialized = await Promise.allSettled(currentIds.map(async (personaId) => {
        const payload = await readRoomQueue(roomId, personaId, 0, true);
        return [personaId, Math.max(0, Number(payload.latestId || 0))] as const;
      }));
      const ready = initialized.filter((item): item is PromiseFulfilledResult<readonly [string, number]> => item.status === 'fulfilled');
      if (!ready.length) {
        const firstFailure = initialized.find((item): item is PromiseRejectedResult => item.status === 'rejected');
        throw new Error(firstFailure?.reason instanceof Error ? firstFailure.reason.message : 'Could not connect to any invited bot audio stream.');
      }
      cursorsRef.current = new Map(ready.map((item) => item.value));
      seenRef.current.clear();
      queueRef.current = [];
      blockedRef.current = false;
      enabledRef.current = true;
      setEnabled(true);
      setStatus(ready.length === 1 ? 'Bot audio enabled · listening for replies.' : `Bot audio enabled · listening to ${ready.length} invited bots.`);
      if (ready.length < currentIds.length) setStatus(`Connected to ${ready.length} of ${currentIds.length} bots; some room audio streams are unavailable.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not enable room bot audio.');
    } finally {
      setConnecting(false);
    }
  }, [connecting, idsKey, roomId]);

  const resumeFromCard = useCallback(() => { void enableOrResume(); }, [enableOrResume]);

  useEffect(() => {
    if (!idsKey || autoStartedKeyRef.current === idsKey) return;
    autoStartedKeyRef.current = idsKey;
    void enableOrResume();
  }, [enableOrResume, idsKey]);

  useEffect(() => {
    onUserGestureReady?.(resumeFromCard);
    return () => onUserGestureReady?.(() => {});
  }, [onUserGestureReady, resumeFromCard]);

  useEffect(() => {
    const currentAudio = audioRef.current;
    const activePersonaId = activePersonaIdRef.current;
    if (currentAudio && activePersonaId) currentAudio.volume = clampVolume(volumeByPersona[activePersonaId] ?? 0.8);
  }, [volumeByPersona]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let inFlight = false;

    const poll = async () => {
      if (stopped || inFlight || !enabledRef.current) return;
      inFlight = true;
      try {
        const results = await Promise.all(ids.map(async (personaId) => {
          if (!cursorsRef.current.has(personaId)) {
            const initial = await readRoomQueue(roomId, personaId, 0, true);
            cursorsRef.current.set(personaId, Math.max(0, Number(initial.latestId || 0)));
            return { personaId, items: [] as Array<{ id?: number; audioUrl?: string }> };
          }
          const after = cursorsRef.current.get(personaId) || 0;
          const payload = await readRoomQueue(roomId, personaId, after, false);
          return { personaId, items: Array.isArray(payload.items) ? payload.items : [] };
        }));
        if (stopped) return;
        for (const result of results) {
          for (const rawItem of result.items) {
            const id = Number(rawItem?.id || 0);
            const audioUrl = String(rawItem?.audioUrl || '');
            const key = `${result.personaId}:${id}`;
            if (!id || id <= (cursorsRef.current.get(result.personaId) || 0) || !audioUrl || seenRef.current.has(key)) continue;
            seenRef.current.add(key);
            queueRef.current.push({ id, audioUrl, personaId: result.personaId });
          }
        }
        playNextRef.current();
      } catch (error) {
        if (!stopped) setStatus(error instanceof Error ? `Room audio connection issue: ${error.message}` : 'Room audio connection issue.');
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [enabled, roomId, idsKey]);

  useEffect(() => () => {
    enabledRef.current = false;
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  return <span className="sr-only" aria-live="polite">{status}</span>;
}
