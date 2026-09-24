import { renderSpotlightControl, renderSpotlightPlayer } from '@/lib/spotlight-player-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(renderSpotlightPlayer(), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
