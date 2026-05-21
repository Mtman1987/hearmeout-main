import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

const MAX_FAVORITES = 10;

interface Favorite {
  videoId: string;
  title: string;
  artist: string;
  url: string;
  thumbnail?: string;
  addedAt: string;
  cached: boolean;
}

// GET /api/favorites?userId=xxx
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
  if (userId !== session.uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await ensureDb();
  const data = db.get('favorites', userId);
  const favorites: Favorite[] = data?.songs || [];
  const updated = favorites.map(f => ({ ...f, cached: false }));

  return NextResponse.json({ favorites: updated, count: updated.length, max: MAX_FAVORITES });
}

// POST /api/favorites — heart a song
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId, videoId, title, artist, url, thumbnail } = await req.json();
  if (!userId || !videoId) return NextResponse.json({ error: 'userId and videoId required' }, { status: 400 });
  if (userId !== session.uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await ensureDb();
  const data = db.get('favorites', userId) || { songs: [] };
  let favorites: Favorite[] = data.songs || [];

  // Already favorited? Just return success. We do not trigger server-side ripping
  // from the favorites path anymore.
  if (favorites.some(f => f.videoId === videoId)) {
    return NextResponse.json({ success: true, message: 'Already in favorites', downloadUrl: null, cached: false });
  }

  // At cap? Evict oldest but still add the new one
  if (favorites.length >= MAX_FAVORITES) {
    const evicted = favorites[0];
    favorites = favorites.slice(1);
    console.log(`[Favorites] Evicted oldest: "${evicted.title}" for ${userId}`);
  }

  favorites.push({
    videoId,
    title: title || 'Unknown',
    artist: artist || 'Unknown',
    url: url || `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail,
    addedAt: new Date().toISOString(),
    cached: false,
  });

  db.set('favorites', userId, { songs: favorites });

  return NextResponse.json({
    success: true,
    message: `Added "${title}" to favorites`,
    downloadUrl: null,
    cached: false,
  });
}

// DELETE /api/favorites — remove a favorite
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId, videoId } = await req.json();
  if (!userId || !videoId) return NextResponse.json({ error: 'userId and videoId required' }, { status: 400 });
  if (userId !== session.uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await ensureDb();
  const data = db.get('favorites', userId);
  if (!data?.songs) return NextResponse.json({ success: true });

  const updated = data.songs.filter((f: Favorite) => f.videoId !== videoId);
  db.set('favorites', userId, { songs: updated });

  return NextResponse.json({ success: true, removed: videoId });
}
