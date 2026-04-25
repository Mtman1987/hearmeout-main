import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { addSongToPlaylist, autoRadioNext } from '@/lib/bot-actions';

export async function POST(req: NextRequest) {
  try {
    await ensureDb();
    const { action, sessionId, userId, data } = await req.json();

    const room = db.get('rooms', sessionId);
    if (!room) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    switch (action) {
      case 'pause_session':
        db.update('rooms', sessionId, { isPlaying: false });
        break;

      case 'resume_session':
        db.update('rooms', sessionId, { isPlaying: true });
        break;

      case 'skip_track': {
        const playlist = room.playlist || [];
        if (playlist.length > 0) {
          const i = playlist.findIndex((t: any) => t.id === room.currentTrackId);
          const next = playlist[(i + 1) % playlist.length];
          const updates: any = { currentTrackId: next.id, isPlaying: true };
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

      case 'toggle_auto_radio':
        db.update('rooms', sessionId, { autoRadio: !room.autoRadio });
        break;

      case 'auto_radio_next': {
        const result = await autoRadioNext(sessionId);
        return NextResponse.json({ success: result.success, message: result.message });
      }

      case 'kick_user':
        if (userId) db.delete(`rooms/${sessionId}/users`, userId);
        break;

      case 'mute_user':
      case 'unmute_user':
        break;

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    // Return updated session
    const updated = db.get('rooms', sessionId);
    const users = db.list(`rooms/${sessionId}/users`);
    const track = updated.playlist?.find((t: any) => t.id === updated.currentTrackId);

    return NextResponse.json({
      success: true,
      message: `Action ${action} completed`,
      session: {
        id: sessionId,
        roomName: updated.name,
        ownerId: updated.ownerId,
        isActive: users.length > 0,
        userCount: users.length,
        users: users.map((u: any) => ({
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
  } catch (e: any) {
    return NextResponse.json({ error: 'Internal error', details: e.message }, { status: 500 });
  }
}
