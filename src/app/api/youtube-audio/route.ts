import { NextRequest, NextResponse } from 'next/server';

// Jamendo provides free music with direct MP3 URLs
async function searchJamendo(query: string) {
  const res = await fetch(
    `https://api.jamendo.com/v3.0/tracks/?client_id=56d30c95&format=json&limit=1&search=${encodeURIComponent(query)}&audioformat=mp32`
  );
  const data = await res.json();
  
  if (data.results?.[0]) {
    const track = data.results[0];
    return {
      url: track.audio,
      title: track.name,
      artist: track.artist_name,
      thumbnail: track.album_image,
    };
  }
  throw new Error('No results found');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  const query = searchParams.get('query');

  // If it's a direct URL, just return it
  if (url && !url.includes('youtube.com') && !url.includes('youtu.be')) {
    return NextResponse.json({ url });
  }

  // If it's a search query, use Jamendo
  if (query) {
    try {
      const result = await searchJamendo(query);
      return NextResponse.json(result);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
  }

  // For YouTube URLs, we can't help without yt-dlp
  return NextResponse.json({ 
    error: 'YouTube URLs require yt-dlp. Use search query instead or provide direct audio URL.' 
  }, { status: 400 });
}
