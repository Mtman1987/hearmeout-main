import { NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';

const STALE_MS = 45_000;

function isPersistentPersonaPresence(id: string, data: any) {
  const personaId = String(data?.personaId || '').trim();
  return Boolean(
    data?.bot === true
    && (
      data?.presenceKind === 'persona'
      || String(id || '').startsWith('persona:')
      || personaId
    )
  );
}

export async function POST() {
  try {
    await ensureDb();
    const rooms = db.list('rooms');
    let pruned = 0;
    let preservedPersonas = 0;
    const now = Date.now();

    for (const room of rooms) {
      const roomId = room.id;
      const usersCollection = `rooms/${roomId}/users`;
      const users = db.list(usersCollection);
      for (const u of users) {
        if (isPersistentPersonaPresence(u.id, u.data)) {
          preservedPersonas += 1;
          continue;
        }
        const lastSeen = Number(u.data?.lastSeen || 0);
        if (!lastSeen || now - lastSeen > STALE_MS) {
          db.delete(usersCollection, u.id);
          pruned += 1;
        }
      }
    }

    return NextResponse.json({ success: true, pruned, preservedPersonas, staleMs: STALE_MS });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'Failed to prune presence' }, { status: 500 });
  }
}
