import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, unlinkSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { isValidVideoId } from './validate-video-id';

const execFileAsync = promisify(execFile);
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const CACHE_DIR = process.env.MUSIC_CACHE_DIR || join(process.cwd(), 'data', 'music');
const COOKIES_FILE = ['/data/youtube-cookies.txt', join(process.cwd(), 'youtube-cookies.txt')]
  .find(p => existsSync(p)) || '';

// Extra argv passed to yt-dlp. Everything here is constant / env-controlled, never user input.
function ytdlpExtraArgs(): string[] {
  const args: string[] = ['--js-runtimes', 'node'];
  if (COOKIES_FILE && existsSync(COOKIES_FILE)) args.push('--cookies', COOKIES_FILE);
  return args;
}

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

// Track in-progress rips to avoid duplicates
const inProgress = new Map<string, Promise<string | null>>();

export function isCached(videoId: string): boolean {
  if (!isValidVideoId(videoId)) return false;
  return existsSync(join(CACHE_DIR, `${videoId}.mp3`));
}

export function getCachedUrl(videoId: string): string | null {
  if (isCached(videoId)) return `/api/music/${videoId}`;
  return null;
}

export async function ripAndCache(videoId: string): Promise<string | null> {
  if (!isValidVideoId(videoId)) {
    console.error(`[Ripper] Rejecting invalid videoId: ${JSON.stringify(videoId).slice(0, 64)}`);
    return null;
  }
  if (isCached(videoId)) return `/api/music/${videoId}`;

  // Deduplicate concurrent rips for the same video
  if (inProgress.has(videoId)) return inProgress.get(videoId)!;

  const promise = doRip(videoId);
  inProgress.set(videoId, promise);
  try {
    return await promise;
  } finally {
    inProgress.delete(videoId);
  }
}

async function doRip(videoId: string): Promise<string | null> {
  // videoId is guaranteed-safe here (11 chars, [A-Za-z0-9_-]) — checked in ripAndCache.
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const tempM4a = join(CACHE_DIR, `${videoId}.m4a`);
  const finalMp3 = join(CACHE_DIR, `${videoId}.mp3`);

  try {
    console.log(`[Ripper] Downloading ${videoId}...`);
    const { stdout, stderr } = await execFileAsync(
      YT_DLP,
      [
        ...ytdlpExtraArgs(),
        '-f', 'bestaudio[ext=m4a]/bestaudio/best',
        '--no-playlist',
        '-o', tempM4a,
        url,
      ],
      { timeout: 60000 }
    );
    if (stderr) console.log(`[Ripper] stderr: ${stderr.slice(0, 300)}`);
    if (stdout) console.log(`[Ripper] stdout: ${stdout.slice(0, 200)}`);

    if (!existsSync(tempM4a)) throw new Error('Download produced no file');

    console.log(`[Ripper] Converting ${videoId} to mp3...`);
    await execFileAsync(
      FFMPEG,
      ['-y', '-i', tempM4a, '-vn', '-ab', '128k', finalMp3],
      { timeout: 60000 }
    );

    // Clean up temp
    try { unlinkSync(tempM4a); } catch {}

    if (!existsSync(finalMp3)) throw new Error('Conversion produced no file');

    const size = statSync(finalMp3).size;
    console.log(`[Ripper] Cached ${videoId} (${Math.round(size / 1024)}KB)`);
    return `/api/music/${videoId}`;
  } catch (e: any) {
    console.error(`[Ripper] Failed for ${videoId}:`, e.message);
    try { unlinkSync(tempM4a); } catch {}
    try { unlinkSync(finalMp3); } catch {}
    return null;
  }
}

/** Download from a pre-extracted URL (no yt-dlp needed) + convert to mp3 */
export async function ripWithUrl(videoId: string, audioStreamUrl: string): Promise<string | null> {
  if (!isValidVideoId(videoId)) {
    console.error(`[Ripper] Rejecting invalid videoId: ${JSON.stringify(videoId).slice(0, 64)}`);
    return null;
  }
  if (isCached(videoId)) return `/api/music/${videoId}`;
  if (inProgress.has(videoId)) return inProgress.get(videoId)!;

  const promise = doRipFromUrl(videoId, audioStreamUrl);
  inProgress.set(videoId, promise);
  try { return await promise; } finally { inProgress.delete(videoId); }
}

async function doRipFromUrl(videoId: string, audioStreamUrl: string): Promise<string | null> {
  const tempFile = join(CACHE_DIR, `${videoId}.tmp`);
  const finalMp3 = join(CACHE_DIR, `${videoId}.mp3`);

  try {
    console.log(`[Ripper] Downloading ${videoId} from CDN...`);
    const { writeFile } = await import('fs/promises');
    const res = await fetch(audioStreamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.youtube.com/',
      },
    });
    if (!res.ok) throw new Error(`CDN fetch failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(tempFile, buffer);
    console.log(`[Ripper] Downloaded ${Math.round(buffer.length / 1024)}KB`);

    console.log(`[Ripper] Converting ${videoId} to mp3...`);
    await execFileAsync(
      FFMPEG,
      ['-y', '-i', tempFile, '-vn', '-ab', '128k', finalMp3],
      { timeout: 60000 }
    );
    try { unlinkSync(tempFile); } catch {}

    if (!existsSync(finalMp3)) throw new Error('Conversion produced no file');
    const size = statSync(finalMp3).size;
    console.log(`[Ripper] Cached ${videoId} (${Math.round(size / 1024)}KB)`);
    return `/api/music/${videoId}`;
  } catch (e: any) {
    console.error(`[Ripper] URL rip failed for ${videoId}:`, e.message);
    try { unlinkSync(tempFile); } catch {}
    try { unlinkSync(finalMp3); } catch {}
    return null;
  }
}

/** Get total cache size in bytes */
export function getCacheStats(): { files: number; totalBytes: number } {
  try {
    const files = readdirSync(CACHE_DIR).filter(f => f.endsWith('.mp3'));
    const totalBytes = files.reduce((sum, f) => sum + statSync(join(CACHE_DIR, f)).size, 0);
    return { files: files.length, totalBytes };
  } catch {
    return { files: 0, totalBytes: 0 };
  }
}
