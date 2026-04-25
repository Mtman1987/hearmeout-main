import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    await ensureDb();
    const activeOnly = new URL(req.url).searchParams.get('active') === 'true';

    const rooms = db.list('rooms');

    const sessions = rooms.map((room) => {
      const d = room.data;
      const users = db.list(`rooms/${room.id}/users`);
      const track = d.playlist?.find((t: any) => t.id === d.currentTrackId);

      return {
        id: room.id,
        roomName: d.name || 'Untitled Room',
        ownerId: d.ownerId,
        ownerName: d.ownerName || 'Unknown',
        isActive: users.length > 0,
        userCount: users.length,
        users: users.map((u: any) => ({
          id: u.id,
          username: u.data.displayName || 'Anonymous',
          avatar: u.data.photoURL,
          isMuted: false,
          isDeafened: false,
          joinedAt: u.data.joinedAt || new Date().toISOString(),
        })),
        currentTrack: track ? {
          id: track.id,
          title: track.title || 'Unknown',
          artist: track.artist || 'Unknown',
          duration: track.duration || 0,
          position: 0,
          isPlaying: d.isPlaying || false,
        } : undefined,
        playlist: d.playlist || [],
        autoRadio: d.autoRadio || false,
        settings: { isPublic: !d.isPrivate, maxUsers: 50, allowGuestDJ: true, requireAuth: false },
        createdAt: d.createdAt || new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };
    });

    const filtered = activeOnly ? sessions.filter(s => s.isActive || s.currentTrack) : sessions;
    return NextResponse.json({ sessions: filtered, total: filtered.length });
  } catch (e: any) {
    return NextResponse.json({ error: 'Internal error', details: e.message }, { status: 500 });
  }
}
