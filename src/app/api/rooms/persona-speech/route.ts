import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { requireRoomVoiceAccess } from '@/lib/room-voice-access';

export const dynamic = 'force-dynamic';

const STREAMWEAVER_BASE_URL = String(
  process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev',
).replace(/\/$/, '');

function clean(value: unknown, max: number, fallback: string): string {
  return String(value || '')
    .trim()
    .slice(0, max)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || fallback;
}

function streamKey(roomId: string, personaId: string): string {
  // Keep in sync with StreamWeaver's hearMeOutSayStreamKey().
  return `hmo-say-${clean(roomId, 96, 'room')}-${clean(personaId, 96, 'persona')}`.slice(0, 128);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const roomId = String(params.get('roomId') || '').trim().slice(0, 160);
  const personaId = String(params.get('personaId') || '').trim().slice(0, 128);
  if (!roomId || !personaId) {
    return NextResponse.json({ ok: false, error: 'roomId and personaId are required' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    // This endpoint is routed through public middleware for compatibility with
    // the room UI, so enforce the room's real session/password/ban/expiry guard here.
    await requireRoomVoiceAccess(roomId);
    await ensureDb();
    const presenceId = `persona:${personaId}`;
    const presence = db.get(`rooms/${roomId}/users`, presenceId);
    if (
      !presence
      || presence.bot !== true
      || (presence.presenceKind !== 'persona' && presence.personaId !== personaId && presence.ownerTenantId !== personaId)
    ) {
      return NextResponse.json({ ok: false, error: 'Persona is not active in this room' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }

    const upstreamUrl = new URL('/api/say/next', STREAMWEAVER_BASE_URL);
    const tenantId = streamKey(roomId, personaId);
    upstreamUrl.searchParams.set('tenantId', tenantId);
    if (params.get('latest') === '1') {
      upstreamUrl.searchParams.set('latest', '1');
    } else {
      const afterRaw = Number(params.get('after') || 0);
      const after = Number.isFinite(afterRaw) ? Math.max(0, afterRaw) : 0;
      upstreamUrl.searchParams.set('after', String(after));
    }

    // This poll touches StreamWeaver's Say listener presence as well as reading
    // room-scoped audio. No synthesis/provider credentials cross into the browser.
    const response = await fetch(upstreamUrl, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
    });
    if (!response.ok) {
      return NextResponse.json({ ok: false, error: 'StreamWeaver speech queue is unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    const payload = await response.json().catch(() => ({})) as any;
    return NextResponse.json({
      ok: true,
      tenantId,
      latestId: Number(payload?.latestId || 0),
      items: Array.isArray(payload?.items) ? payload.items : [],
      remaining: Number(payload?.remaining || 0),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const accessErrors = new Set([
      'Sign in to join a voice room',
      'Room was not found',
      'Room expired',
      'You are banned from this room',
      'Room password is required',
    ]);
    if (accessErrors.has(message)) {
      const status = message === 'Sign in to join a voice room' ? 401
        : message === 'Room was not found' ? 404
          : message === 'Room expired' ? 410 : 403;
      return NextResponse.json({ ok: false, error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
    console.warn('[HearMeOut Room Say Player] Queue poll failed:', message || 'unknown error');
    return NextResponse.json({ ok: false, error: 'Could not connect to the room speech queue' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
