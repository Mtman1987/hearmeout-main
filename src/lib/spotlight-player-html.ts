import { renderLoungePlayer } from './lounge-player-html';

export function renderSpotlightPlayer() {
  return renderLoungePlayer()
    .replace('SpaceMountain Lounge live view', 'SpaceMountain community Spotlight')
    .replaceAll('https://hmo-dj-worker.fly.dev:4444/lounge/live.mp4', 'https://hmo-dj-worker.fly.dev:4445/spotlight/live.mp4')
    .replaceAll('Lounge', 'Spotlight')
    .replace('video.volume=.85;video.muted=false;', 'video.volume=.58;video.muted=false;')
    .replace("const mixOutput='media'", "const mixOutput='spotlight'");
}

export function renderSpotlightControl() {
  return renderSpotlightPlayer();
}
