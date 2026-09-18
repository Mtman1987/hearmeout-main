import { NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { getDjWorkerRequestHeaders } from '@/lib/dj-worker-auth';

export const dynamic = 'force-dynamic';

const ROOM_ID = 'system-spacemountainlive-lounge';
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
};

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function resolveSystemPersona(): Promise<PublicBot | null> {
  const response = await fetch(`${STREAMWEAVER_BASE_URL}/api/internal/hearmeout/bots`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(12000) : undefined,
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => ({})) as any;
  const bots = (payload?.data?.bots || payload?.bots || []) as PublicBot[];
  const available = bots.filter((bot) => bot?.canInvite !== false);
  return available.find((bot) => normalize(bot.ownerTenantId) === 'spacemountainlive' && [
    bot.name, ...(bot.aliases || []), ...(bot.wakeNames || []),
  ].some((name) => normalize(name) === 'stella'))
    || available.find((bot) => normalize(bot.ownerTenantId) === 'spacemountainlive')
    || available.find((bot) => [bot.name, ...(bot.aliases || []), ...(bot.wakeNames || [])]
      .some((name) => normalize(name) === 'stella'))
    || null;
}

export async function GET() {
  await ensureDb();
  const now = new Date().toISOString();
  const existing = db.get('rooms', ROOM_ID) || {};
  db.set('rooms', ROOM_ID, {
    ...existing,
    id: ROOM_ID,
    name: existing.name || 'SpaceMountainLive Lounge',
    description: existing.description || 'Permanent Hear Me Out media room for the SpaceMountainLive channel.',
    ownerId: 'spacemountainlive',
    ownerName: 'SpaceMountainLive',
    isPrivate: true,
    password: undefined,
    systemRoom: true,
    persistent: true,
    expiresAt: undefined,
    playlist: Array.isArray(existing.playlist) ? existing.playlist : [],
    playHistory: Array.isArray(existing.playHistory) ? existing.playHistory : [],
    isPlaying: Boolean(existing.isPlaying),
    createdAt: existing.createdAt || now,
    updatedAt: now,
  }, { merge: true });

  const bot = await resolveSystemPersona();
  let personaReady = false;
  if (bot) {
    const workerResponse = await fetch(`${getDjWorkerUrl()}/persona`, {
      method: 'POST',
      headers: getDjWorkerRequestHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify({
        action: 'join',
        roomId: ROOM_ID,
        personaId: bot.ownerTenantId,
        displayName: bot.name,
        ownerTenantId: bot.ownerTenantId,
        ownerName: bot.ownerName || '',
        wakeNames: bot.wakeNames || [bot.name, ...(bot.aliases || [])],
        aliases: bot.aliases || [],
        interests: bot.interests || [],
        voice: bot.voice || '',
        livekitTtsDescriptor: bot.livekitTtsDescriptor || '',
        avatar: bot.avatar || '',
        idleAvatar: bot.idleAvatar || bot.avatar || '',
        talkingAvatar: bot.talkingAvatar || bot.idleAvatar || bot.avatar || '',
        serviceSession: true,
      }),
      cache: 'no-store',
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20000) : undefined,
    }).catch(() => null);

    if (workerResponse?.ok) {
      const presenceId = `persona:${bot.ownerTenantId}`;
      db.set(`rooms/${ROOM_ID}/users`, presenceId, {
        id: presenceId,
        uid: presenceId,
        displayName: bot.name,
        photoURL: bot.idleAvatar || bot.avatar || '',
        bot: true,
        personaId: bot.ownerTenantId,
        ownerName: bot.ownerName || '',
        wakeNames: bot.wakeNames || [bot.name, ...(bot.aliases || [])],
        aliases: bot.aliases || [],
        interests: bot.interests || [],
        presenceKind: 'persona',
        persistent: true,
        lastSeen: Date.now(),
      }, { merge: true });
      personaReady = true;
    }
  }

  return NextResponse.json({
    ok: true,
    roomId: ROOM_ID,
    systemRoom: true,
    persistent: true,
    persona: bot ? { id: bot.ownerTenantId, name: bot.name, ready: personaReady } : null,
  }, { headers: { 'cache-control': 'no-store' } });
}
