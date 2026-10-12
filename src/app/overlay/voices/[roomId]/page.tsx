'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Room, RoomEvent, Track, RemoteParticipant, RemoteTrackPublication } from 'livekit-client';

// A transparent, receive-only source: no camera, microphone, video or music room.
export default function StreamVoices() {
  const { roomId } = useParams<{ roomId: string }>();
  const search = useSearchParams();
  const sourceKey = search.get('sourceKey') || '';
  const audioRoot = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('connecting');
  useEffect(() => {
    let stopped = false;
    let ended = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let room: Room | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let volume = 1;
    let muted = false;
    const elements = new Set<HTMLMediaElement>();
    const applyVolume = () => elements.forEach(audio => { audio.volume = volume; audio.muted = muted; });
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://spmt.live' || event.source !== window.parent || event.data?.type !== 'spmt.obspmt.audio') return;
      const next = Number(event.data.volume);
      if (Number.isFinite(next) && next >= 0 && next <= 1) volume = next;
      if (typeof event.data.muted === 'boolean') muted = event.data.muted;
      applyVolume();
    };
    window.addEventListener('message', onMessage);
    const clearAudio = () => { elements.forEach(audio => audio.remove()); elements.clear(); };
    const subscribe = (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (publication.kind !== Track.Kind.Audio) return;
      // Music already has its own stream source; never play it a second time.
      if (/^(dj-|dj-worker-|stream-listener:)/.test(participant.identity) || /^(overlay-music|music)$/i.test(publication.trackName)) return;
      publication.setSubscribed(true);
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
        const active = new Room({ adaptiveStream: false, dynacast: false });
        room = active;
        active.on(RoomEvent.TrackPublished, subscribe);
        active.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind !== Track.Kind.Audio || stopped) return;
          const audio = track.attach();
          audio.autoplay = true;
          elements.add(audio);
          audioRoot.current?.appendChild(audio);
          applyVolume();
          audio.play().catch(() => { if (!stopped) setStatus('audio-blocked'); });
        });
        active.on(RoomEvent.TrackUnsubscribed, track => track.detach().forEach(audio => { elements.delete(audio); audio.remove(); }));
        active.on(RoomEvent.Reconnecting, () => { if (!stopped) setStatus('reconnecting'); });
        active.on(RoomEvent.Reconnected, () => { if (!stopped) setStatus('connected'); });
        active.on(RoomEvent.Disconnected, () => {
          clearAudio();
          if (!stopped && !ended && !retry) retry = setTimeout(() => { retry = undefined; void connect(); }, 5000);
        });
        await active.connect(credentials.url, credentials.token, { autoSubscribe: false });
        if (stopped) { await active.disconnect(); return; }
        active.remoteParticipants.forEach(participant => participant.trackPublications.forEach(publication => subscribe(publication, participant)));
        await active.startAudio();
        setStatus('connected');
      } catch {
        if (room) await room.disconnect().catch(() => {});
        if (!stopped && !ended) {
          setStatus('reconnecting');
          if (!retry) retry = setTimeout(() => { retry = undefined; void connect(); }, 5000);
        }
      }
    };
    void connect();
    const enabledTimer = setInterval(async () => {
      if (stopped || ended) return;
      try {
        const r = await fetch('/api/voice/stream-source?' + new URLSearchParams({ roomId, sourceKey, statusOnly: '1' }), { cache: 'no-store' });
        if ([401, 403, 410].includes(r.status)) { ended = true; setStatus('ended'); clearAudio(); void room?.disconnect(); }
      } catch {}
    }, 15000);
    return () => { stopped = true; clearInterval(enabledTimer); if (expiryTimer) clearTimeout(expiryTimer); if (retry) clearTimeout(retry); window.removeEventListener('message', onMessage); clearAudio(); void room?.disconnect(); };
  }, [roomId, sourceKey]);
  return <><style>{`html,body{background:transparent!important;min-height:0!important} body>header{display:none!important}`}</style><div ref={audioRoot} data-stream-voice-room={roomId} data-stream-voice-status={status} aria-hidden="true" style={{ position: 'fixed', inset: 0, background: 'transparent', pointerEvents: 'none' }} /></>;
}
