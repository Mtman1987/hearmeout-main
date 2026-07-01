import { NextResponse } from 'next/server';
import { controlWatchSession, getPublicWatchSession } from '@/lib/watch-request-service';
import { controlGlobalMusicSession, getGlobalMusicWatchSession } from '@/lib/music-session-service';
import { MUSIC_WATCH_SESSION_ID } from '@/lib/watch-session';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const ACTIONS = new Set(['play', 'pause', 'seek', 'next', 'jump', 'clear', 'mute', 'unmute']);

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const url = new URL(request.url);
  const action = String(url.searchParams.get('action') || '').toLowerCase();
  const positionParam = url.searchParams.get('position');
  const position = positionParam === null ? undefined : Number(positionParam || 0);
  const targetIndex = Number(url.searchParams.get('targetIndex'));

  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: 'Unsupported control action' }, { status: 400, headers: CORS_HEADERS });
  }

  if (sessionId === MUSIC_WATCH_SESSION_ID) {
    const session = await controlGlobalMusicSession(action, position);
    const watchSession = await getGlobalMusicWatchSession();
    const title = session.current?.title || 'music room';
    const label = action === 'seek' ? 'Synced' : action === 'clear' ? 'Cleared' : action[0].toUpperCase() + action.slice(1);

    if (url.searchParams.get('format') === 'json') {
      return NextResponse.json({ success: true, action, session: watchSession }, { headers: CORS_HEADERS });
    }

    return new NextResponse(`<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${label}</title></head><body><main><h1>${label}</h1><p>${title}</p></main></body></html>`, {
      headers: {
        ...CORS_HEADERS,
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  let session;
  try {
    session = await controlWatchSession(sessionId, action, position, targetIndex, {
      actorUserId: url.searchParams.get('actorUserId') || url.searchParams.get('userId') || undefined,
      roomId: url.searchParams.get('roomId') || undefined,
      guildId: url.searchParams.get('guildId') || undefined,
      channelId: url.searchParams.get('channelId') || undefined,
      isHost: ['1', 'true', 'yes'].includes(String(url.searchParams.get('isHost') || '').toLowerCase()),
      isAdmin: ['1', 'true', 'yes'].includes(String(url.searchParams.get('isAdmin') || '').toLowerCase()),
      platform: (url.searchParams.get('platform') as any) || undefined,
    });
  } catch (error: any) {
    const message = error?.message || 'Unable to update watch session';
    const status = message.includes('Only the room host or an admin') ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status, headers: CORS_HEADERS });
  }
  const title = session.current?.item.title || 'watch room';
  const label = action === 'seek' ? 'Synced' : action === 'clear' ? 'Cleared' : action[0].toUpperCase() + action.slice(1);

  if (url.searchParams.get('format') === 'json') {
    return NextResponse.json({ success: true, action, session: getPublicWatchSession(session) }, { headers: CORS_HEADERS });
  }

  return new NextResponse(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${label}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #05070a; color: #e5edf5; font-family: Arial, sans-serif; }
      main { width: min(520px, calc(100vw - 32px)); border: 1px solid #334155; border-radius: 8px; padding: 22px; background: #0f172a; }
      h1 { margin: 0 0 10px; font-size: 20px; }
      p { margin: 0; color: #cbd5e1; }
    </style>
  </head>
  <body>
    <main>
      <h1>${label}</h1>
      <p>${title}</p>
    </main>
  </body>
</html>`, {
    headers: {
      ...CORS_HEADERS,
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
