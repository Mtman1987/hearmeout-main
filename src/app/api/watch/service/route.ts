import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, ensureDb } from '@/lib/db';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { canManageRoom } from '@/lib/room-access';
import { getResolvedWatchSession } from '@/lib/watch-request-service';
import { isActivityRoomId } from '@/lib/watch-session';
import { findXtreamCatalogItemById, getResolvedXtreamStreamUrl, type XtreamKind } from '@/lib/watch/xtream-provider';

async function authorizeRoom(roomId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room && !isActivityRoomId(roomId)) return { ok: false as const, status: 404, error: 'Room not found' };
  const dbUser = db.get('users', session.uid) || {};
  const user = { ...dbUser, uid: session.uid };
  const ownerId = room?.ownerId || room?.createdBy;
  const allowed = isActivityRoomId(roomId)
    || dbUser.isAdmin === true
    || ownerId === session.uid
    || (ownerId && canManageRoom(user, ownerId));
  if (!allowed) return { ok: false as const, status: 403, error: 'Not authorized' };
  return { ok: true as const, session };
}

async function callWorker(path: string, init?: RequestInit) {
  const workerUrl = getDjWorkerUrl();
  if (!workerUrl) return { ok: false, status: 503, body: { error: 'Media worker is not configured' } };
  try {
    const response = await fetch(`${workerUrl}${path}`, {
      ...init,
      cache: 'no-store',
      headers: getDjWorkerRequestHeaders({ 'content-type': 'application/json', ...(init?.headers || {}) }),
    });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
  } catch (error: any) {
    return { ok: false, status: 502, body: { error: `Media worker is unreachable: ${error?.message || error}` } };
  }
}

function streamKeyForItem(item: any): { kind: XtreamKind; id: string; streamId: string } | null {
  const itemMatch = String(item?.id || '').match(/^xtream-(vod)-(\d+)$/i);
  if (itemMatch) return { kind: 'vod', id: itemMatch[2], streamId: `vod-${itemMatch[2]}` };
  const episodeMatch = String(item?.playbackUrl || '').match(/^\/activity-provider\/xtream\/episode\/(\d+)-([a-z0-9]+)$/i);
  if (episodeMatch) return { kind: 'episode', id: `${episodeMatch[1]}-${episodeMatch[2]}`, streamId: `episode-${episodeMatch[1]}-${episodeMatch[2].toLowerCase()}` };
  return null;
}

export async function GET(request: NextRequest) {
  const roomId = String(request.nextUrl.searchParams.get('roomId') || '');
  const auth = await authorizeRoom(roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const result = await callWorker('/watch/cache/status');
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const roomId = String(body.roomId || '');
  const auth = await authorizeRoom(roomId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const action = String(body.action || '');

  if (action === 'prepare') {
    const selected = body.itemId ? await findXtreamCatalogItemById(body.itemId) : null;
    const current = body.sessionId ? getResolvedWatchSession(String(body.sessionId)).current?.item : null;
    const item = selected || current;
    const stream = streamKeyForItem(item);
    if (!stream) return NextResponse.json({ error: 'Select an Xtream VOD or episode first' }, { status: 400 });
    const sourceUrl = await getResolvedXtreamStreamUrl(stream.kind, stream.id);
    const result = await callWorker('/watch/cache/control', {
      method: 'POST',
      body: JSON.stringify({ action: 'prepare', streamId: stream.streamId, sourceUrl: sourceUrl.toString() }),
    });
    return NextResponse.json(result.body, { status: result.status });
  }

  if (action === 'prune' || action === 'clear') {
    const result = await callWorker('/watch/cache/control', {
      method: 'POST',
      body: JSON.stringify({ action, streamId: body.streamId, targetBytes: body.targetBytes }),
    });
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json({ error: 'Unsupported service action' }, { status: 400 });
}
