'use client';
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

const worker = 'https://hmo-lounge-worker.fly.dev';
type Movie = { active: boolean; requestId?: string; title?: string; requester?: string; ready?: boolean; bufferedSeconds?: number; error?: string | null };
export default function DirectLoungePlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const requestRef = useRef('');
  const enableSoundRef = useRef<() => void>(() => {});
  const [movie, setMovie] = useState<Movie>({ active: false });
  const [playing, setPlaying] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let mix = .85, master = 1, source = 1, muted = false, brb = false, autoplayMuted = false;
    const video = videoRef.current!;
    const applyVolume = () => { video.volume = Math.min(1, mix * master * source); video.muted = muted || brb || autoplayMuted; };
    applyVolume();
    enableSoundRef.current = () => {
      autoplayMuted = false; applyVolume();
      video.play().then(() => setSoundBlocked(false)).catch(() => {
        autoplayMuted = true; applyVolume();
        setSoundBlocked(true);
      });
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== 'https://spmt.live') return;
      if (event.data?.type === 'spmt.obspmt.audio') {
        const level = Number(event.data.volume);
        if (Number.isFinite(level) && level >= 0 && level <= 1 && typeof event.data.muted === 'boolean') {
          source = level; muted = event.data.muted; applyVolume();
        }
      }
      if (event.data?.type === 'spmt-lounge-brb-audio' && typeof event.data.active === 'boolean') {
        brb = event.data.active; applyVolume();
      }
    };
    window.addEventListener('message', onMessage);
    const refreshVolume = async () => {
      try {
        const response = await fetch('https://streamweaver-new.fly.dev/api/lounge/audio-mix', { cache: 'no-store' });
        if (!response.ok) return;
        const state = await response.json();
        const mediaLevel = Number(state?.levels?.media), allLevel = Number(state?.levels?.all ?? 100);
        if (mediaLevel >= 0 && mediaLevel <= 100 && allLevel >= 0 && allLevel <= 100) {
          mix = mediaLevel / 100; master = allLevel / 100; applyVolume();
        }
      } catch {}
    };
    const ahead = () => {
      for (let i = 0; i < video.buffered.length; i++)
        if (video.buffered.start(i) <= video.currentTime + .2 && video.buffered.end(i) > video.currentTime)
          return video.buffered.end(i) - video.currentTime;
      return 0;
    };
    const resume = () => {
      if (ahead() >= 16 && video.paused && !cancelled) video.play().catch((reason) => {
        // Embedded browsers can deny sound before a user gesture. Keep the
        // video moving silently there; the Restream browser may play with sound.
        if (reason?.name === 'NotAllowedError' && !cancelled) {
          autoplayMuted = true; applyVolume();
          video.play().then(() => setSoundBlocked(true)).catch(() => {});
        }
      });
    };
    const onWaiting = () => { if (ahead() < 2) video.pause(); setPlaying(false); };
    const onPlaying = () => setPlaying(true);
    video.addEventListener('progress', resume);
    video.addEventListener('canplay', resume);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('timeupdate', resume);

    const poll = async () => {
      try {
        const [programResponse, statusResponse] = await Promise.all([
          fetch('/api/lounge-media/program', { cache: 'no-store' }),
          fetch(worker + '/lounge/direct/status', { cache: 'no-store' }),
        ]);
        if (cancelled || !programResponse.ok || !statusResponse.ok) return;
        const program = await programResponse.json();
        if (program?.movie?.current && program.movie.playback?.status === 'playing') {
          const next: Movie = await statusResponse.json();
          if (cancelled) return;
          setMovie(next);
          if (!next.ready || !next.requestId || next.requestId === requestRef.current) return;
          requestRef.current = next.requestId;
          setPlaying(false);
          hlsRef.current?.destroy();
          video.pause(); video.removeAttribute('src'); video.load();
          if (Hls.isSupported()) {
            const hls = new Hls({ startPosition: 0, maxBufferLength: 45, maxMaxBufferLength: 90, lowLatencyMode: false });
            hlsRef.current = hls;
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal) {
                hls.destroy(); hlsRef.current = null; requestRef.current = '';
                setPlaying(false);
              }
            });
            hls.attachMedia(video);
            hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(worker + '/lounge/direct/hls/index.m3u8'));
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = worker + '/lounge/direct/hls/index.m3u8';
          }
          return;
        }
        if (program?.music?.current && program.music.playback?.status === 'playing')
          window.location.replace('/lounge-media/player?legacy=1');
        else if (!program?.movie?.current)
          window.location.replace('/lounge-media/player?legacy=1');
      } catch {}
    };
    void poll(); void refreshVolume();
    const timer = window.setInterval(poll, 2500);
    const volumeTimer = window.setInterval(refreshVolume, 3000);
    return () => {
      cancelled = true; window.clearInterval(timer); window.clearInterval(volumeTimer);
      window.removeEventListener('message', onMessage);
      video.removeEventListener('progress', resume); video.removeEventListener('canplay', resume);
      video.removeEventListener('waiting', onWaiting); video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', resume);
      hlsRef.current?.destroy();
    };
  }, []);
  return <main style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
    <video ref={videoRef} playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    {playing && soundBlocked && <button type="button" onClick={() => enableSoundRef.current()}
      style={{ position: 'absolute', right: 14, top: 14, zIndex: 4, padding: '11px 18px', border: '2px solid #fff', borderRadius: 999, background: '#eb6b15', color: '#fff', font: '700 16px system-ui', cursor: 'pointer' }}>Enable movie sound</button>}
    {!playing && <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: '5%', color: '#fff', background: 'radial-gradient(circle,#20153d,#090919 65%,#000)', font: '600 clamp(18px,3vw,32px) system-ui', textAlign: 'center' }}>
      <div style={{ width: 'min(84%,650px)', padding: '5%', border: '2px solid #55d7ed', borderRadius: 24, boxShadow: '0 0 32px #339fd080', background: '#0d1739' }}>
        <div style={{ color: '#77ddf0', fontSize: '65%', letterSpacing: '.12em', textTransform: 'uppercase' }}>Preparing your movie</div>
        <div style={{ margin: '18px 0 10px' }}>{movie.title || 'Loading selection'}</div>
        <div style={{ color: '#d7c5ff', fontSize: '65%' }}>{movie.requester ? 'Selected by ' + movie.requester : ''}</div>
        <div style={{ marginTop: 20, color: '#c1c8d4', fontSize: '55%', fontWeight: 400 }}>
          {movie.error || (movie.ready ? 'Buffering video for smooth playback' : movie.active ? 'Prepared ' + (movie.bufferedSeconds || 0) + ' seconds' : 'Connecting to the Lounge worker')}
        </div>
      </div>
    </div>}
  </main>;
}
