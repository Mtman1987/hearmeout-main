import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

interface RoomUserDoc {
  id: string;
  data: {
    displayName?: string;
    photoURL?: string;
    joinedAt?: string;
  };
}

interface RoomDoc {
  id: string;
  data: {
    name?: string;
    ownerId?: string;
    ownerName?: string;
    isPrivate?: boolean;
    playlist?: Array<{
      id: string;
      title?: string;
      artist?: string;
      duration?: number;
    }>;
    currentTrackId?: string;
    isPlaying?: boolean;
    autoRadio?: boolean;
    createdAt?: string;
  };
}

// firestore.rules grant `allow read: if request.auth != null ||
// resource.data.isPrivate == false` for /rooms/{roomId}, and
// `allow read, write: if request.auth != null` for every subcollection
// under /rooms/{roomId}. Mirror that here:
//   - authenticated session  -> return every room, with full user listings
//                               from rooms/{roomId}/users.
//   - no session             -> return only rooms whose isPrivate field is
//                               explicitly `false` (matching firestore's
//                               `isPrivate == false` semantics, which treats
//                               missing/null as private), and omit the
//                               protected /users subcollection from the
//                               response.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();

    await ensureDb();
    const activeOnly = new URL(req.url).searchParams.get('active') === 'true';

    const allRooms = db.list('rooms') as RoomDoc[];
    const visibleRooms = session
      ? allRooms
      : allRooms.filter((room) => room.data.isPrivate === false);

    const sessions = visibleRooms.map((room) => {
      const d = room.data;
      // /rooms/{roomId}/users is an auth-required subcollection per
      // firestore.rules; only fan out when the caller is authenticated.
      const users = session ? (db.list(`rooms/${room.id}/users`) as RoomUserDoc[]) : [];
      const track = d.playlist?.find((t) => t.id === d.currentTrackId);

      return {
        id: room.id,
        roomName: d.name || 'Untitled Room',
        ownerId: d.ownerId,
        ownerName: d.ownerName || 'Unknown',
        isActive: users.length > 0,
        userCount: users.length,
        users: users.map((u) => ({
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

    const filtered = activeOnly ? sessions.filter((s) => s.isActive || s.currentTrack) : sessions;
    return NextResponse.json({ sessions: filtered, total: filtered.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: 'Internal error', details: message }, { status: 500 });
  }
}
