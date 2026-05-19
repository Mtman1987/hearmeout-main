import { NextResponse } from 'next/server';

// Returns users currently online in HearMeOut rooms
// Used by DiscordStreamHub to show "In HearMeOut" in its UI
export async function GET(request: Request) {
  const baseUrl = request.headers.get('x-forwarded-proto')
    ? `${request.headers.get('x-forwarded-proto')}://${request.headers.get('host')}`
    : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';

  try {
    // Fetch all rooms
    const roomsRes = await fetch(`${baseUrl}/api/db?collection=rooms`, { cache: 'no-store' });
    const rooms = await roomsRes.json();
    if (!Array.isArray(rooms)) return NextResponse.json({ source: 'hearmeout', count: 0, users: [] });

    const onlineUsers: Array<{ id: string; username: string; photoURL: string | null; roomName: string; roomId: string }> = [];
    const now = Date.now();

    for (const room of rooms) {
      const roomName = room.data?.name || room.id;
      try {
        const usersRes = await fetch(`${baseUrl}/api/db?collection=rooms/${room.id}/users`, { cache: 'no-store' });
        const users = await usersRes.json();
        if (!Array.isArray(users)) continue;

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
    return NextResponse.json({ error: error.message, users: [] }, { status: 500 });
  }
}
