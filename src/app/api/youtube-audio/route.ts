import { NextRequest, NextResponse } from 'next/server';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';
const CACHE_DIR = process.env.MUSIC_CACHE_DIR || '/data/music';

if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
  } catch {}
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const urlParam = searchParams.get('url') || '';
  const videoIdParam = searchParams.get('videoId') || '';
  
  let videoId: string;
  if (videoIdParam) {
    videoId = videoIdParam;
  } else if (urlParam) {
    const extracted = extractVideoId(urlParam);
    if (!extracted) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
    videoId = extracted;
  } else {
    return NextResponse.json({ error: "Missing URL or videoId parameter" }, { status: 400 });
  }

  const youTubeUrl = urlParam || `https://youtube.com/watch?v=${videoId}`;
  const filePath = join(CACHE_DIR, `${videoId}.mp3`);

  // Serve from cache if exists
  if (existsSync(filePath)) {
    console.log(`Cached: ${videoId}`);
    return NextResponse.json({ audioUrl: `/api/music/${videoId}` });
  }

  try {
    console.log(`Extracting audio URL for ${videoId} via yt-dlp...`);
    const { stdout } = await execAsync(`yt-dlp -f "bestaudio[ext=m4a]/bestaudio/best" --no-playlist --get-url "${youTubeUrl}"`); // Removed cookies-from-browser: no Firefox on server
    const audioUrl = stdout.trim();
    if (!audioUrl) throw new Error('No audio stream found');

    console.log(`Found audio stream: ${videoId}`);
    return NextResponse.json({ audioUrl });
  } catch (e: any) {
    console.error('YouTube audio fetch failed:', e.message);
    // Fallback: try without bestaudio filter if format fails
    if (e.message.includes('requested format') || e.message.includes('no video formats')) {
      console.log(`Retrying ${videoId} with simpler format...`);
      try {
        const { stdout: fallbackStdout } = await execAsync(`yt-dlp --no-playlist --get-url "${youTubeUrl}"`);
        const fallbackUrl = fallbackStdout.trim();
        if (fallbackUrl) {
          console.log(`Fallback stream found for ${videoId}`);
          return NextResponse.json({ audioUrl: fallbackUrl });
        }
      } catch (fallbackErr) {
        console.error('Fallback also failed:', fallbackErr);
      }
    }
    return NextResponse.json({ error: `YouTube fetch failed: ${e.message}` }, { status: 500 });
  }
}

