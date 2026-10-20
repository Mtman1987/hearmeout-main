'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Peer, { MediaConnection } from 'peerjs';

export default function StreamVoices() {
  const { roomId } = useParams<{ roomId: string }>();
  const search = useSearchParams();
  const sourceKey = search.get('sourceKey') || '';
  const audioRoot = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    let stopped = false, ended = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let peerPoll: ReturnType<typeof setInterval> | undefined;
    let presenceTimer: ReturnType<typeof setInterval> | undefined;
    let peer: Peer | undefined;
    let silentContext: AudioContext | undefined;
    let silentStream: MediaStream | undefined;
    const peerCalls = new Map<string, MediaConnection>();
    const elements = new Set<HTMLMediaElement>();
    const sayCursors = new Map<string, number>();
    const saySeen = new Set<string>();
    const sayQueue: Array<{ id: number; audioUrl: string; personaId: string }> = [];
    const sayAudios = new Set<HTMLAudioElement>();
    let sayPersonaIds: string[] = [];
    let sayRosterRefreshAt = 0;
    let sayPoll: ReturnType<typeof setInterval> | undefined;
    let sayPolling = false;
    let sayPlaying = false;
    const playNextSay = () => {
      if (stopped || ended || sayPlaying || !sayQueue.length) return;
      const next = sayQueue.shift()!;
      sayPlaying = true;
      const audio = document.createElement('audio');
      audio.autoplay = true; audio.preload = 'auto'; audio.setAttribute('playsinline', ''); audio.src = next.audioUrl;
      sayAudios.add(audio); audioRoot.current?.appendChild(audio); applyVolume();
      let settled = false;
      const finish = () => {
        if (settled) return; settled = true; audio.pause(); audio.remove(); sayAudios.delete(audio);
        saySeen.delete(`${next.personaId}:${next.id}`); sayCursors.set(next.personaId, Math.max(sayCursors.get(next.personaId) || 0, next.id));
        sayPlaying = false; playNextSay();
      };
      audio.onended = finish; audio.onerror = finish;
      void audio.play().catch(() => { if (!stopped) setStatus('bot-audio-blocked'); finish(); });
    };
    const pollSayAudio = async () => {
      if (stopped || ended || sayPolling) return;
      sayPolling = true;
      try {
        if (!sayRosterRefreshAt || Date.now() >= sayRosterRefreshAt) {
          const listResponse = await fetch('/api/voice/stream-speech?' + new URLSearchParams({ roomId, sourceKey, list: '1' }), { cache: 'no-store' });
          if (!listResponse.ok) return;
          const listData = await listResponse.json() as { personas?: string[] };
          sayPersonaIds = Array.isArray(listData.personas) ? listData.personas : [];
          sayRosterRefreshAt = Date.now() + 5000;
        }
        const results = await Promise.all(sayPersonaIds.map(async personaId => {
          if (!sayCursors.has(personaId)) {
            const response = await fetch('/api/voice/stream-speech?' + new URLSearchParams({ roomId, sourceKey, personaId, latest: '1' }), { cache: 'no-store' });
            if (!response.ok) return null;
            const data = await response.json() as { latestId?: number };
            sayCursors.set(personaId, Math.max(0, Number(data.latestId || 0)));
            return null;
          }
          const response = await fetch('/api/voice/stream-speech?' + new URLSearchParams({ roomId, sourceKey, personaId, after: String(sayCursors.get(personaId) || 0) }), { cache: 'no-store' });
          if (!response.ok) return null;
          const data = await response.json() as { items?: Array<{ id?: number; audioUrl?: string }> };
          return { personaId, items: Array.isArray(data.items) ? data.items : [] };
        }));
        for (const result of results) {
          if (!result) continue;
          for (const item of result.items) {
            const id = Number(item.id || 0), audioUrl = String(item.audioUrl || ''), key = `${result.personaId}:${id}`;
            if (!id || !audioUrl || id <= (sayCursors.get(result.personaId) || 0) || saySeen.has(key)) continue;
            saySeen.add(key); sayQueue.push({ id, audioUrl, personaId: result.personaId });
            while (sayQueue.length > 24) { const dropped = sayQueue.shift(); if (dropped) { saySeen.delete(`${dropped.personaId}:${dropped.id}`); sayCursors.set(dropped.personaId, Math.max(sayCursors.get(dropped.personaId) || 0, dropped.id)); } }
          }
        }
        playNextSay();
      } catch {} finally { sayPolling = false; }
    };
    let volume = 1, muted = false;
    const applyVolume = () => { elements.forEach(audio => { audio.volume = volume; audio.muted = muted; }); sayAudios.forEach(audio => { audio.volume = volume; audio.muted = muted; }); };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://spmt.live' || event.source !== window.parent || event.data?.type !== 'spmt.obspmt.audio') return;
      const next = Number(event.data.volume);
      if (Number.isFinite(next) && next >= 0 && next <= 1) volume = next;
      if (typeof event.data.muted === 'boolean') muted = event.data.muted;
      applyVolume();
    };
    window.addEventListener('message', onMessage);
    const clearAudio = () => { elements.forEach(audio => { audio.pause(); audio.srcObject = null; audio.remove(); }); elements.clear(); sayAudios.forEach(audio => { audio.pause(); audio.remove(); }); sayAudios.clear(); sayQueue.length = 0; };
    const attachPeerStream = (stream: MediaStream) => {
      if (stopped) return;
      setStatus('audio-received');
      fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ area: 'overlay-voices', message: 'PeerJS remote audio stream received', roomId, identity: peer?.id || null, userAgent: navigator.userAgent }) }).catch(() => {});
      const audio = document.createElement('audio');
      audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.srcObject = stream;
      elements.add(audio); audioRoot.current?.appendChild(audio); applyVolume();
      void audio.play().catch(() => { if (!stopped) setStatus('audio-blocked'); });
    };


    const startPeerFallback = async () => {
      try {
        const context = new AudioContext();
        silentContext = context;
        const oscillator = context.createOscillator(), gain = context.createGain(), destination = context.createMediaStreamDestination();
        gain.gain.value = 0; oscillator.connect(gain); gain.connect(destination); oscillator.start();
        silentStream = destination.stream;
        await new Promise<void>((resolve, reject) => {
          const active = new Peer(`hmo-stream-listener-${roomId}-${Math.random().toString(36).slice(2, 8)}`, { debug: 0 });
          peer = active;
          active.on('open', () => { setStatus('peer-signaling-connected'); resolve(); });
          active.on('error', error => { setStatus('peer-signaling-error'); fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ area: 'overlay-voices', message: `PeerJS signaling error: ${String(error)}`, roomId, identity: active.id || null, userAgent: navigator.userAgent }) }).catch(() => {}); reject(error); });
          active.on('call', call => { call.answer(silentStream!); call.on('stream', attachPeerStream); call.on('close', () => peerCalls.delete(call.peer)); call.on('error', () => peerCalls.delete(call.peer)); });
        });
        // Keep the silent sender track alive for the entire PeerJS session.
        // Closing its AudioContext here ends the track before calls are negotiated.
        const register = async () => { try { const response = await fetch('/api/peer-voice/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, peerId: peer!.id, sourceKey }) }); if (!response.ok) { const detail = await response.text().catch(() => ''); setStatus(`peer-register-${response.status}`); fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ area: 'overlay-voices', message: `Peer presence registration failed: HTTP ${response.status} ${detail}`, roomId, identity: peer?.id || null, userAgent: navigator.userAgent }) }).catch(() => {}); } } catch { setStatus('peer-register-network-error'); } };
        await register(); presenceTimer = setInterval(register, 5000);
        const discover = async () => {
          if (stopped || ended || !peer) return;
          try {
            const response = await fetch('/api/peer-voice/peers?' + new URLSearchParams({ roomId, sourceKey }), { cache: 'no-store' });
            if (!response.ok) { setStatus(`peer-discovery-${response.status}`); return; }
            const data = await response.json() as { peers?: string[] };
            if (!(data.peers || []).some(id => id.startsWith(`hmo-voice-${roomId}-`))) setStatus('waiting-for-room-microphone');
            for (const remoteId of data.peers || []) {
              if (remoteId === peer.id || remoteId.startsWith('hmo-stream-listener-') || peerCalls.has(remoteId)) continue;
              if (/^(hmo-dj-|hmo-viewer-|hmo-screen-)/.test(remoteId)) continue;
              const call = peer.call(remoteId, silentStream!);
              if (!call) continue;
              peerCalls.set(remoteId, call);
              let gotStream = false;
              const callTimeout = setTimeout(() => { if (!gotStream && peerCalls.get(remoteId) === call) { peerCalls.delete(remoteId); try { call.close(); } catch {} setStatus('peer-call-timeout'); } }, 12000);
              call.on('stream', stream => { gotStream = true; clearTimeout(callTimeout); attachPeerStream(stream); });
              call.on('close', () => { clearTimeout(callTimeout); peerCalls.delete(remoteId); });
              call.on('error', () => { clearTimeout(callTimeout); peerCalls.delete(remoteId); });
            }
          } catch {}
        };
        await discover(); peerPoll = setInterval(() => { void discover(); }, 3000);
      } catch {
        if (peer && !peer.destroyed) peer.destroy();
        peer = undefined;
      }
    };

    const validateSource = async () => {
      try {
        const response = await fetch('/api/voice/stream-source?' + new URLSearchParams({ roomId, sourceKey, statusOnly: '1' }), { cache: 'no-store' });
        if ([401, 403, 410].includes(response.status)) { ended = true; setStatus('ended'); return; }
        if (!response.ok) { setStatus(`source-check-${response.status}`); return; }
        const data = await response.json();
        if (data.expiresAt) expiryTimer = setTimeout(() => { ended = true; setStatus('ended'); clearAudio(); }, Math.max(0, data.expiresAt - Date.now()));
        setStatus('waiting-for-room-microphone');
      } catch { setStatus('source-check-network-error'); }
    };
    void validateSource();
    void startPeerFallback();
    void pollSayAudio();
    sayPoll = setInterval(() => { void pollSayAudio(); }, 1000);
    const enabledTimer = setInterval(async () => {
      if (stopped || ended) return;
      try {
        const r = await fetch('/api/voice/stream-source?' + new URLSearchParams({ roomId, sourceKey, statusOnly: '1' }), { cache: 'no-store' });
        if ([401, 403, 410].includes(r.status)) { ended = true; setStatus('ended'); clearAudio(); }
      } catch {}
    }, 15000);
    return () => {
      stopped = true; clearInterval(enabledTimer);
      if (expiryTimer) clearTimeout(expiryTimer);
      if (peerPoll) clearInterval(peerPoll); if (presenceTimer) clearInterval(presenceTimer); if (sayPoll) clearInterval(sayPoll);
      window.removeEventListener('message', onMessage); clearAudio();
      peerCalls.forEach(call => { try { call.close(); } catch {} }); peerCalls.clear();
      if (peer) {
        fetch('/api/peer-voice/register', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, peerId: peer.id, sourceKey }), keepalive: true }).catch(() => {});
        peer.destroy();
      }
      silentStream?.getTracks().forEach(track => track.stop());
      if (silentContext) void silentContext.close().catch(() => {});
    };
  }, [roomId, sourceKey]);

  return <><style>{`html,body{background:transparent!important;min-height:0!important} body>header{display:none!important}`}</style><div ref={audioRoot} data-stream-voice-room={roomId} data-stream-voice-status={status} aria-hidden="true" style={{ position: 'fixed', inset: 0, background: 'transparent', pointerEvents: 'none' }} /></>;
}
