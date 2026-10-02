'use client';
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

const worker = 'https://hmo-dj-worker.fly.dev:4444';
type Movie = { active: boolean; requestId?: string; generation?: string; streamKey?: string; title?: string; requester?: string; ready?: boolean; bufferedSeconds?: number; error?: string | null };
export default function DirectLoungePlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const requestRef = useRef('');
  const [movie, setMovie] = useState<Movie>({ active: false });
  const [playing, setPlaying] = useState(false);
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const announcePlayerLoaded = () => window.parent.postMessage({ type: 'spmt-lounge-media-ready' }, 'https://spmt.live');
    announcePlayerLoaded();
    const readyTimer = window.setInterval(announcePlayerLoaded, 5000);
    let mix = .85, master = 1, source = 1, muted = false;
    const video = videoRef.current!;
    const applyVolume = () => { video.volume = Math.min(1, mix * master * source); video.muted = muted; };
    applyVolume();
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== 'https://spmt.live') return;
      if (event.data?.type === 'spmt.obspmt.audio') {
        const level = Number(event.data.volume);
        if (Number.isFinite(level) && level >= 0 && level <= 1 && typeof event.data.muted === 'boolean') {
          source = level; muted = event.data.muted; applyVolume();
        }
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
      if (ahead() >= 16 && video.paused && !cancelled) video.play().catch(() => {});
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
        const programResponse = await fetch('/api/lounge-media/program', { cache: 'no-store' });
        if (cancelled || !programResponse.ok) return;
        const program = await programResponse.json();
        if (cancelled) return;
        const movieActive = program?.movie?.current && program.movie.playback?.status === 'playing';
        const musicActive = program?.music?.current && program.music.playback?.status === 'playing';
        if (!movieActive && !musicActive) {
          setEmpty(true); setPlaying(false);
          if (requestRef.current) {
            requestRef.current = '';
            hlsRef.current?.destroy(); hlsRef.current = null;
            video.pause(); video.removeAttribute('src'); video.load();
          }
          return;
        }
        setEmpty(false);
        if (program?.movie?.current && program.movie.playback?.status === 'playing') {
          const statusResponse = await fetch(worker + '/lounge/direct/status', { cache: 'no-store' });
          if (cancelled || !statusResponse.ok) return;
          const next: Movie = await statusResponse.json();
          if (cancelled) return;
          setMovie(next);
          const playbackKey = next.requestId && next.generation ? next.requestId + ':' + next.generation : '';
          if (!next.ready || !next.requestId || !next.streamKey || !playbackKey || playbackKey === requestRef.current) return;
          requestRef.current = playbackKey;
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
            hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(worker + '/lounge/direct/hls/' + encodeURIComponent(next.streamKey!) + '/index.m3u8'));
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = worker + '/lounge/direct/hls/' + encodeURIComponent(next.streamKey!) + '/index.m3u8';
          }
          return;
        }
        if (program?.music?.current && program.music.playback?.status === 'playing')
          window.location.replace('/lounge-media/player?legacy=1');
      } catch {}
    };
    void poll(); void refreshVolume();
    const timer = window.setInterval(poll, 2500);
    const volumeTimer = window.setInterval(refreshVolume, 3000);
    return () => {
      cancelled = true; window.clearInterval(readyTimer); window.clearInterval(timer); window.clearInterval(volumeTimer);
      window.removeEventListener('message', onMessage);
      video.removeEventListener('progress', resume); video.removeEventListener('canplay', resume);
      video.removeEventListener('waiting', onWaiting); video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', resume);
      hlsRef.current?.destroy();
    };
  }, []);
  return <main data-empty-request-prompt="v2" style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
    <video ref={videoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    {!playing && <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: '5%', color: '#fff', background: 'radial-gradient(circle,#20153d,#090919 65%,#000)', font: empty ? '600 clamp(10px,3vw,32px) system-ui' : '600 clamp(18px,3vw,32px) system-ui', textAlign: 'center' }}>
      <div style={{ width: 'min(92%,650px)', boxSizing: 'border-box', padding: empty ? 'clamp(6px,2vw,32px)' : 'clamp(12px,3vw,32px)', border: '2px solid #55d7ed', borderRadius: 16, boxShadow: '0 0 32px #339fd080', background: '#0d1739' }}>
        <div style={{ color: '#77ddf0', fontSize: empty ? 'clamp(9px,1.6vw,20px)' : '65%', letterSpacing: '.12em', textTransform: 'uppercase' }}>{empty ? 'Requests welcome' : 'Preparing your movie'}</div>
        <div style={{ margin: empty ? '6px 0' : '10px 0', fontSize: empty ? 'clamp(12px,3vw,30px)' : undefined }}>{empty ? 'What should we play next?' : movie.title || 'Loading selection'}</div>
        <div style={{ color: '#d7c5ff', fontSize: empty ? 'clamp(10px,2vw,22px)' : '65%' }}>{empty ? 'Request a song: !sr <song or artist>' : movie.requester ? 'Selected by ' + movie.requester : ''}</div>
        <div style={{ marginTop: empty ? 6 : 20, color: '#c1c8d4', fontSize: empty ? 'clamp(10px,1.5vw,18px)' : '55%', fontWeight: 400 }}>
          {empty ? 'Request something to watch: !wr <title or link>' : movie.error || (movie.ready ? 'Buffering video for smooth playback' : movie.active ? 'Prepared ' + (movie.bufferedSeconds || 0) + ' seconds' : 'Connecting to the Lounge worker')}
        </div>
      </div>
    </div>}
  </main>;
}
