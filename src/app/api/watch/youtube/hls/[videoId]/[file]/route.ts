import { NextResponse } from 'next/server';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { isValidVideoId } from '@/lib/validate-video-id';
import { getResolvedYoutubeUrls } from '@/app/api/watch/youtube/resolve/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, range',
};

function cleanMachineId(machineId: string | null) {
  const clean = String(machineId || '').replace(/[^a-zA-Z0-9]/g, '');
  return clean || null;
}

function cleanHlsFileName(fileName: string) {
  const clean = String(fileName || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!clean || clean.includes('..')) throw new Error('Invalid HLS file');
  return clean;
}

export async function GET(request: Request, context: { params: Promise<{ videoId: string; file: string }> }) {
  const { videoId, file } = await context.params;

  try {
    if (!isValidVideoId(videoId)) {
      return NextResponse.json({ error: 'Invalid YouTube video id' }, { status: 400, headers: CORS_HEADERS });
    }

    const cleanFile = cleanHlsFileName(file);
    const workerUrl = getDjWorkerUrl();
    if (!workerUrl) {
      return NextResponse.json({ error: 'DJ worker not configured' }, { status: 503, headers: CORS_HEADERS });
    }

    const requestUrl = new URL(request.url);
    const pinnedMachine = cleanMachineId(requestUrl.searchParams.get('machine'));
    const remoteUrl = new URL(`${workerUrl}/watch/youtube/hls/${encodeURIComponent(videoId)}/${encodeURIComponent(cleanFile)}`);
    if (pinnedMachine) remoteUrl.searchParams.set('machine', pinnedMachine);

    // If a client already resolved the stream URLs, pass them to the DJ worker
    // so it can skip yt-dlp and use the client-provided URLs directly
    if (cleanFile === 'index.m3u8') {
      const resolved = getResolvedYoutubeUrls(videoId);
      if (resolved) {
        remoteUrl.searchParams.set('source', resolved.videoUrl);
        remoteUrl.searchParams.set('audioSource', resolved.audioUrl);
      }
    }

    const workerHeaders: Record<string, string> = {
      'user-agent': 'HearMeOut/1.0',
    };
    if (pinnedMachine) workerHeaders['fly-force-instance-id'] = pinnedMachine;

    const MAX_WAIT = 55_000;
    const POLL_INTERVAL = 2500;
    const start = Date.now();
    let workerResponse = await fetch(remoteUrl, { headers: workerHeaders });

    while (workerResponse.status === 202 && Date.now() - start < MAX_WAIT) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      workerResponse = await fetch(remoteUrl, { headers: workerHeaders });
    }

    const headers = new Headers(CORS_HEADERS);
    for (const header of ['content-type', 'content-length', 'cache-control']) {
      const value = workerResponse.headers.get(header);
      if (value) headers.set(header, value);
    }

    if (workerResponse.status === 202) {
      headers.set('retry-after', '3');
    }

    return new NextResponse(workerResponse.body, {
      status: workerResponse.status,
      headers,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'YouTube HLS conversion failed' }, { status: 502, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
