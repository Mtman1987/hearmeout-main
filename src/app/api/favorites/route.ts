import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { ripAndCache, isCached, getCachedUrl } from '@/lib/music-ripper';
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

  await ensureDb();
  const data = db.get('favorites', userId);
  const favorites: Favorite[] = data?.songs || [];
  const updated = favorites.map(f => ({ ...f, cached: isCached(f.videoId) }));

  return NextResponse.json({ favorites: updated, count: updated.length, max: MAX_FAVORITES });
}

// POST /api/favorites — heart a song
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId, videoId, title, artist, url, thumbnail } = await req.json();
  if (!userId || !videoId) return NextResponse.json({ error: 'userId and videoId required' }, { status: 400 });

  await ensureDb();
  const data = db.get('favorites', userId) || { songs: [] };
  let favorites: Favorite[] = data.songs || [];

  // Already favorited? Still return the download URL
  if (favorites.some(f => f.videoId === videoId)) {
    const cached = getCachedUrl(videoId);
    if (cached) {
      return NextResponse.json({ success: true, message: 'Already in favorites', downloadUrl: cached, cached: true });
    }
    // Not cached yet — rip it now
    const ripped = await ripAndCache(videoId);
    return NextResponse.json({ success: true, message: 'Already in favorites', downloadUrl: ripped, cached: !!ripped });
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

  // Rip it — await so we can return the download URL
  const downloadUrl = await ripAndCache(videoId);

  // Update cached status
  if (downloadUrl) {
    const current = db.get('favorites', userId);
    if (current?.songs) {
      db.set('favorites', userId, {
        songs: current.songs.map((f: Favorite) =>
          f.videoId === videoId ? { ...f, cached: true } : f
        ),
      });
    }
  }

  return NextResponse.json({
    success: true,
    message: `Added "${title}" to favorites`,
    downloadUrl,
    cached: !!downloadUrl,
  });
}

// DELETE /api/favorites — remove a favorite
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId, videoId } = await req.json();
  if (!userId || !videoId) return NextResponse.json({ error: 'userId and videoId required' }, { status: 400 });

  await ensureDb();
  const data = db.get('favorites', userId);
  if (!data?.songs) return NextResponse.json({ success: true });

  const updated = data.songs.filter((f: Favorite) => f.videoId !== videoId);
  db.set('favorites', userId, { songs: updated });

  return NextResponse.json({ success: true, removed: videoId });
}
