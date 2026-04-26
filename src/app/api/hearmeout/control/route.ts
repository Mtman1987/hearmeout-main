import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { addSongToPlaylist, autoRadioNext } from '@/lib/bot-actions';
import { getSession } from '@/lib/auth';

interface PlaylistTrack {
  id: string;
  title?: string;
  artist?: string;
  duration?: number;
}

interface RoomData {
  name?: string;
  ownerId?: string;
  isPlaying?: boolean;
  currentTrackId?: string;
  playlist?: PlaylistTrack[];
  playHistory?: string[];
  autoRadio?: boolean;
}

interface RoomUserDoc {
  id: string;
  data: { displayName?: string; photoURL?: string };
}

// Authenticated control endpoint. Used by DSH/Discord activities and other
// trusted clients to drive a HearMeOut room. Operations that mutate room
// state (skip, pause, kick, etc.) require the caller to be the room owner;
// add_song is allowed for any signed-in user since rooms accept guest
// requests via the song-request flow.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await ensureDb();
    const { action, sessionId, userId, data } = await req.json();
    if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

    const room = db.get('rooms', sessionId) as RoomData | null;
    if (!room) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const sessionUser = (session.user as { isAdmin?: boolean } | null) ?? null;
    const isOwner = room.ownerId === session.uid;
    const isAdmin = !!sessionUser?.isAdmin;
    const requireOwner = () => {
      if (isOwner || isAdmin) return null;
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    };

    switch (action) {
      case 'pause_session': {
        const denied = requireOwner();
        if (denied) return denied;
        db.update('rooms', sessionId, { isPlaying: false });
        break;
      }

      case 'resume_session': {
        const denied = requireOwner();
        if (denied) return denied;
        db.update('rooms', sessionId, { isPlaying: true });
        break;
      }

      case 'skip_track': {
        const denied = requireOwner();
        if (denied) return denied;
        const playlist = room.playlist || [];
        if (playlist.length > 0) {
          const i = playlist.findIndex((t) => t.id === room.currentTrackId);
          const next = playlist[(i + 1) % playlist.length];
          const updates: Partial<RoomData> = { currentTrackId: next.id, isPlaying: true };
          if (room.currentTrackId) {
            updates.playHistory = [...(room.playHistory || []), room.currentTrackId].slice(-50);
          }
          db.update('rooms', sessionId, updates);
        }
        break;
      }

      case 'add_song': {
        if (!data?.query) return NextResponse.json({ error: 'Missing data.query' }, { status: 400 });
        const result = await addSongToPlaylist(data.query, sessionId, data.requester || 'DSH');
        return NextResponse.json({ success: result.success, message: result.message });
      }

      case 'toggle_auto_radio': {
        const denied = requireOwner();
        if (denied) return denied;
        db.update('rooms', sessionId, { autoRadio: !room.autoRadio });
        break;
      }

      case 'auto_radio_next': {
        const denied = requireOwner();
        if (denied) return denied;
        const result = await autoRadioNext(sessionId);
        return NextResponse.json({ success: result.success, message: result.message });
      }

      case 'kick_user': {
        const denied = requireOwner();
        if (denied) return denied;
        if (userId) db.delete(`rooms/${sessionId}/users`, userId);
        break;
      }

      case 'mute_user':
      case 'unmute_user': {
        const denied = requireOwner();
        if (denied) return denied;
        break;
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const updated = db.get('rooms', sessionId) as RoomData;
    const users = db.list(`rooms/${sessionId}/users`) as RoomUserDoc[];
    const track = updated.playlist?.find((t) => t.id === updated.currentTrackId);

    return NextResponse.json({
      success: true,
      message: `Action ${action} completed`,
      session: {
        id: sessionId,
        roomName: updated.name,
        ownerId: updated.ownerId,
        isActive: users.length > 0,
        userCount: users.length,
        users: users.map((u) => ({
          id: u.id,
          username: u.data.displayName || 'Anonymous',
          avatar: u.data.photoURL,
          isMuted: false,
          isDeafened: false,
        })),
        currentTrack: track ? {
          id: track.id,
          title: track.title,
          artist: track.artist,
          duration: track.duration || 0,
          position: 0,
          isPlaying: updated.isPlaying || false,
        } : undefined,
        playlist: updated.playlist || [],
        autoRadio: updated.autoRadio || false,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: 'Internal error', details: message }, { status: 500 });
  }
}
