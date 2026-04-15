"use server";
import { NextRequest, NextResponse } from 'next/server';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export async function POST(req: NextRequest) {
  const { roomId, videoId, youtubeUrl } = await req.json();
  
  if (!videoId || !roomId) {
    return NextResponse.json({ error: 'Missing videoId or roomId' }, { status: 400 });
  }
  
// Trigger point for your bot - RIPPER WATCH THIS
  console.log(`🔥 RIPPER TRIGGERED: roomId=${roomId}, videoId=${videoId}, url=${youtubeUrl || 'N/A'}`);
  console.log(`📁 Saving playlist backup: /data/rooms/${roomId}.json`);
  
  // Save to playlist (SQLite/JSON)
  const roomPath = join('/data/rooms', `${roomId}.json`);
  mkdirSync('/data/rooms', { recursive: true });
  const roomData = {
    playlist: [{ id: videoId, url: youtubeUrl || `https://youtube.com/watch?v=${videoId}`, addedAt: new Date().toISOString() }],
    currentTrackId: videoId,
    isPlaying: true
  };
  writeFileSync(roomPath, JSON.stringify(roomData, null, 2));
  
  // Your ripper saves to /data/music/videoId.mp3
  return NextResponse.json({ success: true, saveTo: '/data/music/' + videoId + '.mp3', playlistPath: roomPath });
}

