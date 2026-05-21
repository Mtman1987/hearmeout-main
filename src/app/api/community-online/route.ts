import { NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';

// Returns users currently online in HearMeOut rooms
// Used by DiscordStreamHub to show "In HearMeOut" in its UI
export async function GET() {
  try {
    await ensureDb();
    const rooms = db.list('rooms').filter((room) => room.data?.isPrivate === false);

    const onlineUsers: Array<{ id: string; username: string; photoURL: string | null; roomName: string; roomId: string }> = [];
    const now = Date.now();

    for (const room of rooms) {
      const roomName = room.data?.name || room.id;
      try {
        const users = db.list(`rooms/${room.id}/users`);

        for (const u of users) {
          const lastSeen = Number(u.data?.lastSeen || 0);
          if (lastSeen > 0 && now - lastSeen < 45000) {
            onlineUsers.push({
              id: u.id,
              username: u.data?.displayName || 'User',
              photoURL: u.data?.photoURL || null,
              roomName,
              roomId: room.id,
            });
          }
        }
      } catch {}
    }

    return NextResponse.json({
      source: 'hearmeout',
      count: onlineUsers.length,
      users: onlineUsers,
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=15',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message, users: [] }, {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    });
  }
}
