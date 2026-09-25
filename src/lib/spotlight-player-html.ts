import { renderLoungePlayer } from './lounge-player-html';

export function renderSpotlightPlayer() {
  return renderLoungePlayer()
    .replace('SpaceMountain Lounge live view', 'SpaceMountain community Spotlight')
    .replaceAll('/api/lounge-media/live.mp4', '/api/spotlight-media/live.mp4')
    .replaceAll('Lounge', 'Spotlight')
    .replace('video.volume=.85;video.muted=false;', 'video.volume=.58;video.muted=false;')
    .replaceAll('video.play().catch(()=>{})', 'video.play().catch(()=>{video.muted=true;video.play().catch(()=>{})})')
    .replace('\nconnect();\n', "\ndocument.addEventListener('pointerdown',()=>{video.muted=false});connect();\n");
}

export function renderSpotlightControl() {
  return renderSpotlightPlayer();
}
