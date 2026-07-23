import { NextResponse } from 'next/server';
import { effectiveRoomExpiry, ROOM_LIFETIME_HOURS } from '@/lib/room-lifecycle';
import { db, ensureDb } from '@/lib/db';

// Called periodically (e.g. via cron or health check) to:
// 1. Warn admin about rooms expiring within 30 minutes
// 2. Delete expired rooms that are empty

const ADMIN_CHAT_ENDPOINT = '/api/admin-chat';
const WARNING_WINDOW = 30 * 60 * 1000; // 30 minutes before expiry

export async function POST(request: Request) {
  const baseUrl = request.headers.get('x-forwarded-proto')
    ? `${request.headers.get('x-forwarded-proto')}://${request.headers.get('host')}`
    : 'http://localhost:3000';

  try {
    await ensureDb();
    const rooms = db.list('rooms');

    const now = Date.now();
    const warnings: string[] = [];
    const deleted: string[] = [];

    for (const room of rooms) {
      const data = room.data;
      if (!data) continue;

      const expiresAt = effectiveRoomExpiry(data.expiresAt, data.createdAt);
      if (!expiresAt) continue;
      const timeLeft = expiresAt - now;

      if (data.expiresAt !== new Date(expiresAt).toISOString()) {
        db.update('rooms', room.id, { expiresAt: new Date(expiresAt).toISOString() });
      }

      if (timeLeft <= 0) {
        // Room expired — delete it
        db.delete('rooms', room.id);
        deleted.push(data.name || room.id);
      } else if (timeLeft <= WARNING_WINDOW) {
        // Room expiring soon — warn admin
        const minutesLeft = Math.round(timeLeft / 60000);
        warnings.push(`⏰ Room "${data.name || room.id}" expires in ${minutesLeft} minutes. Create a new one if needed.`);
      }
    }

    // Send warnings to admin chat
    for (const message of warnings) {
      await fetch(`${baseUrl}${ADMIN_CHAT_ENDPOINT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, source: 'room-expiry' }),
      }).catch(() => {});
    }

    // Notify about deletions
    for (const name of deleted) {
      await fetch(`${baseUrl}${ADMIN_CHAT_ENDPOINT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `🗑️ Room "${name}" has been auto-deleted (${ROOM_LIFETIME_HOURS}h shelf life expired).`, source: 'room-expiry' }),
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, warnings: warnings.length, deleted: deleted.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET for health-check triggered expiry (can be called by fly.io health checks)
export async function GET(request: Request) {
  return POST(request);
}
