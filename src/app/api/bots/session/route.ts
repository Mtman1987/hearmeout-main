import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, ensureDb } from '@/lib/db';
import { canManageRoom } from '@/lib/room-access';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';
import {
  HMO_SPMT_COOKIE,
  HMO_SPMT_REFRESH_COOKIE,
  hmoSpmtCookieOptions,
  refreshHmoSpmtSession,
} from '@/lib/spmt-session';

const STREAMWEAVER_BASE_URL = String(
  process.env.STREAMWEAVER_BASE_URL || 'https://streamweaver-new.fly.dev',
).replace(/\/$/, '');

type SharedBot = {
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
};

async function fetchCatalog(accessToken: string) {
  const response = await fetch(`${STREAMWEAVER_BASE_URL}/api/spmt/bots`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
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

function findBot(bots: SharedBot[], selector: string): SharedBot | null | 'ambiguous' {
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
  let accessToken = String(request.cookies.get(HMO_SPMT_COOKIE)?.value || '').trim();
  let refreshToken = String(request.cookies.get(HMO_SPMT_REFRESH_COOKIE)?.value || '').trim();
  if (!accessToken) {
    return NextResponse.json({ error: 'Sign in with SPMT to manage bots' }, { status: 401 });
  }

  let catalog = await fetchCatalog(accessToken);
  let refreshed: Awaited<ReturnType<typeof refreshHmoSpmtSession>> = null;
  if (catalog.response.status === 401) {
    refreshed = refreshToken ? await refreshHmoSpmtSession(refreshToken) : null;
    if (refreshed) {
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      catalog = await fetchCatalog(accessToken);
    }
  }
  if (!catalog.response.ok) {
    return NextResponse.json(catalog.payload, { status: catalog.response.status });
  }

  const bots = (catalog.payload?.data?.bots || catalog.payload?.bots || []) as SharedBot[];
  const matched = findBot(bots, selector);
  if (matched === 'ambiguous') {
    return NextResponse.json({ error: `More than one available bot matches ${selector}` }, { status: 409 });
  }
  if (!matched) {
    return NextResponse.json({ error: `No available bot matches ${selector}` }, { status: 404 });
  }
  if (!matched.canInvite) {
    return NextResponse.json({ error: `${matched.name} is not available for room invites` }, { status: 403 });
  }
  if (action === 'join' && db.get(`rooms/${roomId}/banned`, `persona:${matched.ownerTenantId}`)) {
    return NextResponse.json({ error: `${matched.name} is banned from this room` }, { status: 403 });
  }

  const workerUrl = getDjWorkerUrl();
  const workerResponse = await fetch(`${workerUrl}/persona`, {
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
      interests: matched.interests || [],
      voice: matched.voice || '',
      livekitTtsDescriptor: matched.livekitTtsDescriptor || '',
      avatar: matched.avatar || '',
      idleAvatar: matched.idleAvatar || matched.avatar || '',
      talkingAvatar: matched.talkingAvatar || matched.idleAvatar || matched.avatar || '',
      // These OAuth credentials stay server-to-server and only live in the
      // worker's in-memory active persona runtime. They are never returned to
      // the browser, logged, or persisted by the worker.
      spmtAccessToken: action === 'join' ? accessToken : undefined,
      spmtRefreshToken: action === 'join' ? refreshToken : undefined,
    }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20000) : undefined,
  }).catch(() => null);

  if (!workerResponse) {
    return NextResponse.json({ error: 'Persona worker is unavailable' }, { status: 502 });
  }
  const workerPayload = await workerResponse.json().catch(() => ({}));
  if (workerResponse.ok) {
    const presenceId = `persona:${matched.ownerTenantId}`;
    if (action === 'join') {
      db.set(`rooms/${roomId}/users`, presenceId, {
        id: presenceId,
        uid: presenceId,
        displayName: matched.name,
        photoURL: matched.idleAvatar || matched.avatar || '',
        bot: true,
        personaId: matched.ownerTenantId,
        lastSeen: Date.now(),
      }, { merge: true });
    } else {
      db.delete(`rooms/${roomId}/users`, presenceId);
    }
  }
  const response = NextResponse.json({ ...workerPayload, bot: matched }, { status: workerResponse.status });

  if (refreshed) {
    response.cookies.set(HMO_SPMT_COOKIE, refreshed.accessToken, {
      ...hmoSpmtCookieOptions,
      maxAge: refreshed.expiresIn,
    });
    response.cookies.set(HMO_SPMT_REFRESH_COOKIE, refreshed.refreshToken, {
      ...hmoSpmtCookieOptions,
      maxAge: refreshed.refreshExpiresIn,
    });
  }

  return response;
}
