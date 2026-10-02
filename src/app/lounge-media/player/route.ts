export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  // Music returns here from the direct movie player. Read the existing HLS
  // worker feed; the old MP4 browser-capture feed is no longer produced.
  const legacy = new URL(request.url).searchParams.get('legacy') === '1';
  return new Response(null, {
    status: 307,
    headers: {
      location: legacy ? '/lounge-media/worker-media.html?v=music-recovery-1' : '/lounge-media/direct',
      'cache-control': 'no-store',
    },
  });
}
