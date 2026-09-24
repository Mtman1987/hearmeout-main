import { renderSpotlightPlayer } from '@/lib/spotlight-player-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() {
  const html = renderSpotlightPlayer()
    .replaceAll('Spotlight live view', 'HearMeOut Lounge live view')
    .replaceAll('/api/spotlight-media/live.mp4', '/api/lounge-media/live.mp4')
    .replaceAll('Spotlight source', 'Lounge media source')
    .replaceAll('Spotlight viewer', 'Lounge media viewer')
    .replaceAll('Spotlight frame', 'Lounge media frame');
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
