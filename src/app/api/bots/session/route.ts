import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, ensureDb } from '@/lib/db';
import { canManageRoom } from '@/lib/room-access';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';

const STREAMWEAVER_BASE_URL = String(
  process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev',
).replace(/\/$/, '');

type PublicBot = {
  id: string;
  name: string;
  ownerName?: string;
  ownerTenantId: string;
  aliases?: string[];
  wakeNames?: string[];
  interests?: string[];
  voice?: string;
  livekitTtsDescriptor?: string;
  avatar?: string;
  idleAvatar?: string;
  talkingAvatar?: string;
  canInvite?: boolean;
  canTalk?: boolean;
  blockedReason?: string;
};

async function fetchCatalog() {
  const response = await fetch(`${STREAMWEAVER_BASE_URL}/api/internal/hearmeout/bots`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(12000) : undefined,
  });
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || 'Invalid StreamWeaver response' }; }
  return { response, payload };
}

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function findBot(bots: PublicBot[], selector: string): PublicBot | null | 'ambiguous' {
  const needle = normalize(selector);
  if (!needle) return null;
  const exact = bots.filter((bot) =>
    normalize(bot.id) === needle
    || normalize(bot.ownerTenantId) === needle
    || normalize(bot.name) === needle
    || (bot.aliases || []).some((alias) => normalize(alias) === needle)
    || (bot.wakeNames || []).some((wakeName) => normalize(wakeName) === needle),
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return 'ambiguous';
  return null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as any;
  const action = normalize(body?.action);
  const roomId = String(body?.roomId || '').trim().slice(0, 160);
  const selector = String(body?.botId || body?.bot || body?.name || '').trim().slice(0, 160);
  if (!['join', 'leave'].includes(action)) {
    return NextResponse.json({ error: 'action must be join or leave' }, { status: 400 });
  }
  if (!roomId || !selector) {
    return NextResponse.json({ error: 'roomId and bot are required' }, { status: 400 });
  }

  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (!canManageRoom(session.user as any, room.ownerId || room.createdBy || room.hostId)) {
    return NextResponse.json({ error: 'Only the room owner or room staff can manage bots' }, { status: 403 });
  }

  let catalog: Awaited<ReturnType<typeof fetchCatalog>>;
  try {
    catalog = await fetchCatalog();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Persona catalog is unavailable' },
      { status: 502 },
    );
  }
  if (!catalog.response.ok) {
    return NextResponse.json(catalog.payload, { status: catalog.response.status });
  }

  const bots = (catalog.payload?.data?.bots || catalog.payload?.bots || []) as PublicBot[];
  const matched = findBot(bots, selector);
  if (matched === 'ambiguous') {
    return NextResponse.json({ error: `More than one available bot matches ${selector}` }, { status: 409 });
  }
  if (!matched) {
    return NextResponse.json({ error: `No available bot matches ${selector}` }, { status: 404 });
  }
  if (action === 'join' && !matched.canInvite) {
    return NextResponse.json(
      { error: matched.blockedReason || `${matched.name} is not available for room invites` },
      { status: 403 },
    );
  }
  if (action === 'join' && db.get(`rooms/${roomId}/banned`, `persona:${matched.ownerTenantId}`)) {
    return NextResponse.json({ error: `${matched.name} is banned from this room` }, { status: 403 });
  }

  const workerUrl = getDjWorkerUrl();
  let workerResponse: Response;
  try {
    workerResponse = await fetch(`${workerUrl}/persona`, {
      method: 'POST',
      headers: getDjWorkerRequestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
      action,
      roomId,
      personaId: matched.ownerTenantId,
      displayName: matched.name,
      ownerTenantId: matched.ownerTenantId,
      ownerName: matched.ownerName || '',
      wakeNames: matched.wakeNames || [matched.name, ...(matched.aliases || [])],
      aliases: matched.aliases || [],
      // Interests remain public promo/personality metadata. They are not wake
      // triggers; typed and spoken invocation both use the shared wake-name resolver.
      interests: matched.interests || [],
      voice: matched.voice || '',
      livekitTtsDescriptor: matched.livekitTtsDescriptor || '',
      avatar: matched.avatar || '',
      idleAvatar: matched.idleAvatar || matched.avatar || '',
      talkingAvatar: matched.talkingAvatar || matched.idleAvatar || matched.avatar || '',
      serviceSession: action === 'join',
      }),
      cache: 'no-store',
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(45_000) : undefined,
    });
  } catch (error) {
    // Persona identity and speech use the browser Say Player broadcast. If the RTC worker is unreachable,
    // route the failure through the existing fallback so the persistent persona card still appears.
    const reason = `Persona worker request failed: ${error instanceof Error ? error.message : String(error)}`;
    workerResponse = new Response(JSON.stringify({ error: reason }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const workerPayload = await workerResponse.json().catch(() => ({}));
  const presenceId = `persona:${matched.ownerTenantId}`;
  if (workerResponse.ok) {
    if (action === 'join') {
      db.set(`rooms/${roomId}/users`, presenceId, {
        id: presenceId,
        uid: presenceId,
        displayName: matched.name,
        photoURL: matched.idleAvatar || matched.avatar || '',
        bot: true,
        personaId: matched.ownerTenantId,
        ownerName: matched.ownerName || '',
        wakeNames: matched.wakeNames || [matched.name, ...(matched.aliases || [])],
        aliases: matched.aliases || [],
        interests: matched.interests || [],
        presenceKind: 'persona',
        persistent: true,
        transportHealthy: workerPayload?.transportHealthy === true,
        speechMode: 'say-player',
        lastSeen: Date.now(),
      }, { merge: true });
    } else {
      db.delete(`rooms/${roomId}/users`, presenceId);
    }
  } else if (action === 'join' && workerResponse.status >= 500) {
    // Persona speech now uses StreamWeaver's Say Player, so a LiveKit worker
    // outage should not prevent adding the persona for text/local-wake commands.
    // Keep the transport limitation explicit; do not pretend RTC audio joined.
    const reason = String(workerPayload?.error || 'Persona LiveKit transport is unavailable').slice(0, 300);
    db.set(`rooms/${roomId}/users`, presenceId, {
      id: presenceId,
      uid: presenceId,
      displayName: matched.name,
      photoURL: matched.idleAvatar || matched.avatar || '',
      bot: true,
      personaId: matched.ownerTenantId,
      ownerName: matched.ownerName || '',
      wakeNames: matched.wakeNames || [matched.name, ...(matched.aliases || [])],
      aliases: matched.aliases || [],
      interests: matched.interests || [],
      presenceKind: 'persona',
      persistent: true,
      transportHealthy: false,
      speechMode: 'say-player',
      joinMode: 'say-player-fallback',
      joinWarning: reason,
      lastSeen: Date.now(),
    }, { merge: true });
    return NextResponse.json({
      success: true,
      action: 'join',
      degraded: true,
      transportHealthy: false,
      speechMode: 'say-player',
      warning: reason,
      bot: matched,
    }, {
      status: 200,
      headers: { 'cache-control': 'private, no-store' },
    });
  } else if (action === 'leave') {
    // Allow local removal even when the RTC worker is unavailable.
    db.delete(`rooms/${roomId}/users`, presenceId);
    return NextResponse.json({
      success: true,
      action: 'leave',
      warning: 'Room presence was removed; worker disconnect could not be confirmed.',
      bot: matched,
    }, {
      status: 200,
      headers: { 'cache-control': 'private, no-store' },
    });
  }

  return NextResponse.json({ ...workerPayload, bot: matched }, {
    status: workerResponse.status,
    headers: { 'cache-control': 'private, no-store' },
  });
}
