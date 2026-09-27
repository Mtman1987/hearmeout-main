import { renderLoungePlayer } from '@/lib/lounge-player-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  if (new URL(request.url).searchParams.get('legacy') !== '1')
    return new Response(null, {
      status: 307,
      headers: { location: '/lounge-media/direct', 'cache-control': 'no-store' },
    });
  return new Response(renderLoungePlayer(), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
