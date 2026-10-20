'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Peer, { MediaConnection } from 'peerjs';
import { Room, RoomEvent, Track, RemoteParticipant, RemoteTrackPublication } from 'livekit-client';

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
    let retry: ReturnType<typeof setTimeout> | undefined;
    let room: Room | undefined, peer: Peer | undefined;
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
      const audio = document.createElement('audio');
      audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.srcObject = stream;
      elements.add(audio); audioRoot.current?.appendChild(audio); applyVolume();
      void audio.play().catch(() => { if (!stopped) setStatus('audio-blocked'); });
    };
    const subscribe = (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (publication.kind !== Track.Kind.Audio) return;
      if (/^(dj-|dj-worker-|stream-listener:)/.test(participant.identity) || /^(overlay-music|music)$/i.test(publication.trackName)) return;
      publication.setSubscribed(true);
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
          active.on('open', () => resolve());
          active.on('error', reject);
          active.on('call', call => { call.answer(silentStream!); call.on('stream', attachPeerStream); call.on('close', () => peerCalls.delete(call.peer)); });
        });
        oscillator.stop(); await context.close().catch(() => {}); silentContext = undefined;
        const register = () => fetch('/api/peer-voice/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, peerId: peer!.id, sourceKey }) }).catch(() => {});
        await register(); presenceTimer = setInterval(register, 5000);
        const discover = async () => {
          if (stopped || ended || !peer) return;
          try {
            const response = await fetch('/api/peer-voice/peers?' + new URLSearchParams({ roomId, sourceKey }), { cache: 'no-store' });
            if (!response.ok) return;
            const data = await response.json() as { peers?: string[] };
            for (const remoteId of data.peers || []) {
              if (remoteId === peer.id || remoteId.startsWith('hmo-stream-listener-') || peerCalls.has(remoteId)) continue;
              if (/^(hmo-dj-|hmo-viewer-|hmo-screen-)/.test(remoteId)) continue;
              const call = peer.call(remoteId, silentStream!);
              if (!call) continue;
              peerCalls.set(remoteId, call);
              call.on('stream', attachPeerStream);
              call.on('close', () => peerCalls.delete(remoteId));
              call.on('error', () => peerCalls.delete(remoteId));
            }
          } catch {}
        };
        await discover(); peerPoll = setInterval(() => { void discover(); }, 3000);
      } catch {
        if (peer && !peer.destroyed) peer.destroy();
        peer = undefined;
      }
    };

    const connect = async () => {
      if (stopped || ended) return;
      try {
        setStatus('connecting');
        const response = await fetch('/api/voice/stream-source?' + new URLSearchParams({ roomId, sourceKey }), { cache: 'no-store' });
        if ([401, 403, 410].includes(response.status)) { ended = true; setStatus('ended'); return; }
        if (!response.ok) throw new Error('Voice listener is unavailable');
        const credentials = await response.json();
        if (credentials.expiresAt) expiryTimer = setTimeout(() => { ended = true; setStatus('ended'); clearAudio(); void room?.disconnect(); }, Math.max(0, credentials.expiresAt - Date.now()));
        if (stopped || ended) return;
        const active = new Room({ adaptiveStream: false, dynacast: false }); room = active;
        active.on(RoomEvent.TrackPublished, subscribe);
        active.on(RoomEvent.TrackSubscribed, track => {
          if (track.kind !== Track.Kind.Audio || stopped) return;
          const audio = track.attach(); audio.autoplay = true; elements.add(audio);
          audioRoot.current?.appendChild(audio); applyVolume();
          void audio.play().catch(() => { if (!stopped) setStatus('audio-blocked'); });
        });
        active.on(RoomEvent.TrackUnsubscribed, track => track.detach().forEach(audio => { elements.delete(audio); audio.remove(); }));
        active.on(RoomEvent.Reconnecting, () => { if (!stopped) setStatus('reconnecting'); });
        active.on(RoomEvent.Reconnected, () => { if (!stopped) setStatus('connected'); });
        active.on(RoomEvent.Disconnected, () => { if (!stopped && !ended && !retry) retry = setTimeout(() => { retry = undefined; void connect(); }, 5000); });
        await active.connect(credentials.url, credentials.token, { autoSubscribe: false });
        if (stopped) { await active.disconnect(); return; }
        active.remoteParticipants.forEach(p => p.trackPublications.forEach(pub => subscribe(pub, p)));
        await active.startAudio(); setStatus('connected');
      } catch {
        if (room) await room.disconnect().catch(() => {});
        if (!stopped && !ended) { setStatus('reconnecting'); if (!retry) retry = setTimeout(() => { retry = undefined; void connect(); }, 5000); }
      }
    };
    void connect(); void startPeerFallback();
    const enabledTimer = setInterval(async () => {
      if (stopped || ended) return;
      try {
        const r = await fetch('/api/voice/stream-source?' + new URLSearchParams({ roomId, sourceKey, statusOnly: '1' }), { cache: 'no-store' });
        if ([401, 403, 410].includes(r.status)) { ended = true; setStatus('ended'); clearAudio(); void room?.disconnect(); }
      } catch {}
    }, 15000);
    return () => {
      stopped = true; clearInterval(enabledTimer);
      if (expiryTimer) clearTimeout(expiryTimer); if (retry) clearTimeout(retry);
      if (peerPoll) clearInterval(peerPoll); if (presenceTimer) clearInterval(presenceTimer);
      window.removeEventListener('message', onMessage); clearAudio();
      peerCalls.forEach(call => { try { call.close(); } catch {} }); peerCalls.clear();
      if (peer) {
        fetch('/api/peer-voice/register', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, peerId: peer.id, sourceKey }), keepalive: true }).catch(() => {});
        peer.destroy();
      }
      silentStream?.getTracks().forEach(track => track.stop());
      if (silentContext) void silentContext.close().catch(() => {});
      void room?.disconnect();
    };
  }, [roomId, sourceKey]);

  return <><style>{`html,body{background:transparent!important;min-height:0!important} body>header{display:none!important}`}</style><div ref={audioRoot} data-stream-voice-room={roomId} data-stream-voice-status={status} aria-hidden="true" style={{ position: 'fixed', inset: 0, background: 'transparent', pointerEvents: 'none' }} /></>;
}
