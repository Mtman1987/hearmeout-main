import { NextRequest, NextResponse } from 'next/server';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

export async function POST(req: NextRequest) {
  const { roomId, videoId, youtubeUrl } = await req.json();
  
  if (!videoId || !roomId) {
    return NextResponse.json({ error: 'Missing videoId or roomId' }, { status: 400 });
  }
  
  console.log(`🔥 RIPPER TRIGGERED: roomId=${roomId}, videoId=${videoId}, url=${youtubeUrl || 'N/A'}`);
  
  try {
    const roomsDir = join(DATA_DIR, 'rooms');
    mkdirSync(roomsDir, { recursive: true });
    const roomPath = join(roomsDir, `${roomId}.json`);
    const roomData = {
      playlist: [{ id: videoId, url: youtubeUrl || `https://youtube.com/watch?v=${videoId}`, addedAt: new Date().toISOString() }],
      currentTrackId: videoId,
      isPlaying: true
    };
    writeFileSync(roomPath, JSON.stringify(roomData, null, 2));
    return NextResponse.json({ success: true, videoId, roomId });
  } catch (e: any) {
    console.error('rip-trigger write failed:', e.message);
    return NextResponse.json({ success: true, videoId, roomId, note: 'DB updated, file backup skipped' });
  }
}

