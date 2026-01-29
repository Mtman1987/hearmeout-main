import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { getStorage } from 'firebase-admin/storage';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

const execAsync = promisify(exec);

const PIPED_INSTANCES = [
  "https://piped.video",
  "https://pipedapi.kavin.rocks",
  "https://piped.mha.fi",
  "https://piped.privacydev.net",
  "https://piped-api.garudalinux.org",
  "https://api.piped.projectsegfau.lt"
];

const TIMEOUT_MS = 5000;

if (!getApps().length) {
  try {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID || 'studio-4331919473-dea24',
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'studio-4331919473-dea24.firebasestorage.app',
    });
  } catch (e) {
    console.warn('Firebase Admin init failed, Storage fallback disabled:', e);
  }
}

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
  } catch {
    return null;
  }
  return null;
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function tryPipedInstances(videoId: string) {
  const errors: string[] = [];

  for (const instance of PIPED_INSTANCES) {
    try {
      const apiUrl = `${instance}/streams/${videoId}`;
      const res = await fetchWithTimeout(apiUrl, TIMEOUT_MS);

      if (!res.ok) {
        errors.push(`HTTP ${res.status} from ${instance}`);
        continue;
      }

      const data = await res.json();
      
      if (!data.audioStreams?.length) {
        errors.push(`No audio streams from ${instance}`);
        continue;
      }

      const best = data.audioStreams.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      
      if (!best?.url) {
        errors.push(`No valid URL from ${instance}`);
        continue;
      }

      console.log(`Piped success from ${instance}`);
      return { url: best.url, source: 'piped' };
    } catch (err: any) {
      errors.push(`${instance}: ${err.message}`);
    }
  }

  throw new Error(`All Piped instances failed: ${errors.join(', ')}`);
}

async function downloadAndUpload(videoId: string, youtubeUrl: string) {
  try {
    const bucket = getStorage().bucket();
    const fileName = `music/${videoId}.mp3`;
    const file = bucket.file(fileName);

    const [exists] = await file.exists();
    if (exists) {
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
      console.log(`Using cached file for ${videoId}`);
      return { url: signedUrl, source: 'storage-cached' };
    }

    const tempDir = tmpdir();
    const tempAudio = join(tempDir, `${videoId}.mp3`);

    console.log(`Downloading ${videoId} with yt-dlp...`);
    await execAsync(`yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${tempAudio}" "${youtubeUrl}"`);

    console.log(`Uploading ${videoId} to Storage...`);
    await bucket.upload(tempAudio, {
      destination: fileName,
      metadata: {
        contentType: 'audio/mpeg',
        cacheControl: 'public, max-age=604800',
      },
    });

    await unlink(tempAudio);

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    console.log(`Successfully uploaded ${videoId}`);
    return { url: signedUrl, source: 'storage-new' };
  } catch (e: any) {
    console.error('Storage fallback failed:', e.message);
    throw e;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: "Missing url query parameter" }, { status: 400 });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  try {
    // Try Piped first
    const result = await tryPipedInstances(videoId);
    return NextResponse.json(result);
  } catch (pipedError: any) {
    console.warn('Piped failed, trying Storage fallback:', pipedError.message);
    
    try {
      // Fallback to download + Storage
      const result = await downloadAndUpload(videoId, url);
      return NextResponse.json(result);
    } catch (storageError: any) {
      console.error('All methods failed:', storageError.message);
      return NextResponse.json({ 
        error: `Unable to resolve audio: ${pipedError.message}. Storage fallback: ${storageError.message}` 
      }, { status: 500 });
    }
  }
}
