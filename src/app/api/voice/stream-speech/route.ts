import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { effectiveRoomExpiry } from '@/lib/room-lifecycle';
import { validVoiceSource } from '@/lib/stream-voice-access';

export const dynamic = 'force-dynamic';
const STREAMWEAVER_BASE_URL = String(
  process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev',
).replace(/\/$/, '');
const headers = { 'Cache-Control': 'private, no-store' };

function clean(value: unknown, max: number, fallback: string): string {
  return String(value || '').trim().slice(0, max).toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || fallback;
}
function streamKey(roomId: string, personaId: string): string {
  return `hmo-say-${clean(roomId, 96, 'room')}-${clean(personaId, 96, 'persona')}`.slice(0, 128);
}

// An active stream overlay is the public Say Player for both the room-scoped
// stream and the persona's public stream. Touch both queue keys during roster
// refresh so a reply arriving immediately after overlay startup cannot race
// the first per-persona poll and be incorrectly dropped as "no listener".
async function touchSayListener(tenantId: string): Promise<boolean> {
  const url = new URL('/api/say/next', STREAMWEAVER_BASE_URL);
  url.searchParams.set('tenantId', tenantId);
  url.searchParams.set('latest', '1');
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(4000) : undefined,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const roomId = String(params.get('roomId') || '').trim().slice(0, 96);
  const sourceKey = String(params.get('sourceKey') || '');
  if (!roomId || !validVoiceSource(roomId, sourceKey)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers });
  }

  try {
    await ensureDb();
    const room = db.get('rooms', roomId);
    if (!room) return NextResponse.json({ ok: false, error: 'Room not found' }, { status: 404, headers });
    const expiresAt = effectiveRoomExpiry(room.expiresAt, room.createdAt);
    if (expiresAt !== null && expiresAt <= Date.now()) {
      return NextResponse.json({ ok: false, error: 'Room ended' }, { status: 410, headers });
    }
    if (!room.streamVoiceEnabled) {
      return NextResponse.json({ ok: false, error: 'Voice broadcast is disabled' }, { status: 403, headers });
    }

    if (params.get('list') === '1') {
      const personas = db.list(`rooms/${roomId}/users`)
        .filter(({ id, data }) => data?.bot === true && (
          data?.presenceKind === 'persona' || !!data?.personaId || !!data?.ownerTenantId
        ))
        .map(({ id, data }) => String(data?.personaId || data?.ownerTenantId || id.replace(/^persona:/, '')).trim())
        .filter((id) => !!id && id.length <= 128);
      const uniquePersonas = Array.from(new Set(personas));

      // StreamWeaver only considers a Say queue active after /api/say/next is
      // polled. The overlay's roster request is our earliest reliable heartbeat;
      // mark both supported delivery keys before returning the roster.
      const presenceChecks = uniquePersonas.flatMap((personaId) => [
        touchSayListener(streamKey(roomId, personaId)),
        touchSayListener(personaId),
      ]);
      const presenceResults = await Promise.all(presenceChecks);
      if (presenceResults.some((active) => !active)) {
        console.warn('[HearMeOut stream Say audio] One or more Say listener heartbeats failed.');
      }
      return NextResponse.json({ ok: true, personas: uniquePersonas }, { headers });
    }

    const personaId = String(params.get('personaId') || '').trim().slice(0, 128);
    if (!personaId) return NextResponse.json({ ok: false, error: 'personaId is required' }, { status: 400, headers });
    const presence = db.get(`rooms/${roomId}/users`, `persona:${personaId}`);
    if (!presence || presence.bot !== true || (
      presence.presenceKind !== 'persona' && presence.personaId !== personaId && presence.ownerTenantId !== personaId
    )) {
      return NextResponse.json({ ok: false, error: 'Persona is not active in this room' }, { status: 403, headers });
    }

    const upstreamUrl = new URL('/api/say/next', STREAMWEAVER_BASE_URL);
    upstreamUrl.searchParams.set('tenantId', streamKey(roomId, personaId));
    if (params.get('latest') === '1') upstreamUrl.searchParams.set('latest', '1');
    else {
      const raw = Number(params.get('after') || 0);
      upstreamUrl.searchParams.set('after', String(Number.isFinite(raw) ? Math.max(0, raw) : 0));
    }
    const response = await fetch(upstreamUrl, {
      headers: { Accept: 'application/json' }, cache: 'no-store',
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
    });
    if (!response.ok) return NextResponse.json({ ok: false, error: 'Speech queue is unavailable' }, { status: 502, headers });
    const payload = await response.json().catch(() => ({})) as any;
    return NextResponse.json({
      ok: true, latestId: Number(payload?.latestId || 0),
      items: Array.isArray(payload?.items) ? payload.items : [],
      remaining: Number(payload?.remaining || 0),
    }, { headers });
  } catch (error) {
    console.warn('[HearMeOut stream Say audio] Queue poll failed:', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ ok: false, error: 'Could not connect to the speech queue' }, { status: 502, headers });
  }
}
