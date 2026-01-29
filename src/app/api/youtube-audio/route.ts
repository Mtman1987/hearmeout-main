import { NextRequest, NextResponse } from 'next/server';
import ytdl from 'ytdl-core';
import { getStorage } from 'firebase-admin/storage';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { Readable } from 'stream';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'studio-4331919473-dea24',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    storageBucket: 'studio-4331919473-dea24.firebasestorage.app',
  });
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
  const url = searchParams.get('url');

  if (!url) return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });

  const videoId = extractVideoId(url);
  if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

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
      console.log(`Cached: ${videoId}`);
      return NextResponse.json({ url: signedUrl });
    }

    console.log(`Downloading ${videoId}...`);
    
    const audioStream = ytdl(url, {
      quality: 'highestaudio',
      filter: 'audioonly',
    });

    await new Promise((resolve, reject) => {
      const writeStream = file.createWriteStream({
        metadata: { contentType: 'audio/mpeg' },
      });

      audioStream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      audioStream.on('error', reject);
    });

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    console.log(`Uploaded: ${videoId}`);
    return NextResponse.json({ url: signedUrl });
  } catch (e: any) {
    console.error('Download failed:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
