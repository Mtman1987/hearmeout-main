'use client';

import { useEffect, useRef, useState } from 'react';

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

export default function RoomSayPlayerAudio({ roomId, personaIds, volumes = {} }: { roomId: string; personaIds: string[]; volumes?: Record<string, number> }) {
  const idsKey = Array.from(new Set(personaIds.map((id) => String(id || '').trim()).filter(Boolean))).join('\n');
  const ids = idsKey ? idsKey.split('\n') : [];
  const [enabled] = useState(true);
  const [status, setStatus] = useState('Starting room bot audio listener…');
  const cursorsRef = useRef<Map<string, number>>(new Map());
  const seenRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<SayItem[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);
  const blockedRef = useRef(false);
  const enabledRef = useRef(true);
  const volumesRef = useRef<Record<string, number>>(volumes);
  const activeIdsRef = useRef<Set<string>>(new Set(ids));
  const activePersonaRef = useRef<string | null>(null);
  const playNextRef = useRef<() => void>(() => {});

  enabledRef.current = enabled;
  volumesRef.current = volumes;
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
    const requestedVolume = Number(volumesRef.current[next.personaId] ?? 0.8);
    audio.volume = Math.max(0, Math.min(1, Number.isFinite(requestedVolume) ? requestedVolume : 0.8));
    audioRef.current = audio;
    activePersonaRef.current = next.personaId;

    const finish = (failed: boolean) => {
      if (settled) return;
      settled = true;
      cursorsRef.current.set(next.personaId, Math.max(cursorsRef.current.get(next.personaId) || 0, next.id));
      playingRef.current = false;
      if (audioRef.current === audio) {
        audioRef.current = null;
        activePersonaRef.current = null;
      }
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
      if (audioRef.current === audio) {
        audioRef.current = null;
        activePersonaRef.current = null;
      }
      queueRef.current.unshift(next);
      blockedRef.current = true;
      setStatus("The browser blocked playback. Adjust this bot's volume to retry.");
    });
    setStatus('Speaking…');
  };
  playNextRef.current = playNext;

  useEffect(() => {
    const activePersonaId = activePersonaRef.current;
    const currentAudio = audioRef.current;
    if (!activePersonaId || !currentAudio) return;
    const requestedVolume = Number(volumes[activePersonaId] ?? 0.8);
    currentAudio.volume = Math.max(0, Math.min(1, Number.isFinite(requestedVolume) ? requestedVolume : 0.8));
  }, [volumes]);

  useEffect(() => {
    const resumeAfterUserGesture = () => {
      if (!blockedRef.current) return;
      blockedRef.current = false;
      setStatus('Resuming bot audio…');
      playNextRef.current();
    };
    window.addEventListener('hmo-resume-bot-audio', resumeAfterUserGesture);
    return () => window.removeEventListener('hmo-resume-bot-audio', resumeAfterUserGesture);
  }, []);

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

  // The queue listener is intentionally invisible. Per-bot volume and mute
  // controls live on each Say Player bot card instead of in a separate player bar.
  return <span className="sr-only" aria-live="polite">{status}</span>;
}
