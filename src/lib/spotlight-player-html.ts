import { renderLoungePlayer } from './lounge-player-html';

export function renderSpotlightPlayer() {
  return renderLoungePlayer()
    .replace('SpaceMountain Lounge live view', 'SpaceMountain community Spotlight')
    .replaceAll('/api/lounge-media/live.mp4', '/api/spotlight-media/live.mp4')
    .replaceAll('Lounge', 'Spotlight')
    .replace('video.volume=.85;video.muted=false;', 'video.volume=.58;video.muted=true;');
}

export function renderSpotlightControl() {
  return renderSpotlightPlayer();
}
