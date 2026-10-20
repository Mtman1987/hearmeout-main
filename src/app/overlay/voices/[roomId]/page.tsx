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
    let volume = 1, muted = false;
    const applyVolume = () => elements.forEach(audio => { audio.volume = volume; audio.muted = muted; });
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://spmt.live' || event.source !== window.parent || event.data?.type !== 'spmt.obspmt.audio') return;
      const next = Number(event.data.volume);
      if (Number.isFinite(next) && next >= 0 && next <= 1) volume = next;
      if (typeof event.data.muted === 'boolean') muted = event.data.muted;
      applyVolume();
    };
    window.addEventListener('message', onMessage);
    const clearAudio = () => { elements.forEach(audio => { audio.pause(); audio.srcObject = null; audio.remove(); }); elements.clear(); };
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
        oscillator.stop(); await context.close().catch(() => {}); silentContext = undefined;
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
      if (peerPoll) clearInterval(peerPoll); if (presenceTimer) clearInterval(presenceTimer);
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
