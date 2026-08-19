import { NextResponse } from 'next/server';
import { isValidVideoId } from '@/lib/validate-video-id';

const CLIENTS = {
  ANDROID_VR: {
    clientName: 'ANDROID_VR', clientVersion: '1.60.19', deviceMake: 'Oculus',
    deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android',
    osVersion: '12L', hl: 'en', gl: 'US',
  },
  IOS: {
    clientName: 'IOS', clientVersion: '19.45.4', deviceMake: 'Apple',
    deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.1.0.22B83',
    hl: 'en', gl: 'US',
  },
  WEB: {
    clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US',
  },
} as const;

type ClientName = keyof typeof CLIENTS;

export async function POST(request: Request) {
  const apiKey = String(
    process.env.YOUTUBE_INNERTUBE_API_KEY || process.env.YOUTUBE_API_KEY || '',
  ).trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'YouTube playback resolver is not configured' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const body = await request.json().catch(() => null) as {
    videoId?: unknown;
    client?: unknown;
  } | null;
  const videoId = String(body?.videoId || '').trim();
  const clientName = String(body?.client || '').trim() as ClientName;
  const client = CLIENTS[clientName];
  if (!isValidVideoId(videoId) || !client) {
    return NextResponse.json(
      { error: 'Invalid YouTube resolver request' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }

  const upstream = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        videoId,
        context: { client },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = await upstream.json().catch(() => ({
    error: `YouTube API returned ${upstream.status}`,
  }));
  return NextResponse.json(payload, {
    status: upstream.status,
    headers: { 'cache-control': 'no-store' },
  });
}
