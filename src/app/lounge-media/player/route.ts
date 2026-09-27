import { renderLoungePlayer } from '@/lib/lounge-player-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  if (new URL(request.url).searchParams.get('legacy') !== '1')
    return Response.redirect(new URL('/lounge-media/direct', request.url), 307);
  return new Response(renderLoungePlayer(), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
