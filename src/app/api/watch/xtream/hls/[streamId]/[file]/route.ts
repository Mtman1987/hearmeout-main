import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';
import { ensureXtreamHls, getXtreamHlsFile, waitForXtreamHlsIndex } from '@/lib/watch/xtream-hls';
import { getResolvedXtreamStreamUrl, type XtreamKind } from '@/lib/watch/xtream-provider';

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

function parseStreamKey(streamId: string): { kind: XtreamKind; id: string } {
  const clean = String(streamId).toLowerCase().replace(/[^a-z0-9-]/g, '');
  const match = clean.match(/^(vod|series|live)-(\d+)$/) || clean.match(/^(episode)-(\d+-[a-z0-9]+)$/);
  if (match) return { kind: match[1] as XtreamKind, id: match[2] };
  const numeric = clean.replace(/[^0-9]/g, '');
  if (!numeric) throw new Error('Invalid Xtream HLS stream id');
  return { kind: 'vod', id: numeric };
}

export async function GET(request: Request, context: { params: Promise<{ streamId: string; file: string }> }) {
  const { streamId, file } = await context.params;

  try {
    const workerUrl = getDjWorkerUrl();
    if (workerUrl) {
      const requestUrl = new URL(request.url);
      const pinnedMachine = cleanMachineId(requestUrl.searchParams.get('machine'));
      const remoteUrl = new URL(`${workerUrl}/watch/xtream/hls/${encodeURIComponent(streamId)}/${encodeURIComponent(file)}`);
      if (pinnedMachine) remoteUrl.searchParams.set('machine', pinnedMachine);
      if (file === 'index.m3u8') {
        const stream = parseStreamKey(streamId);
        const upstreamUrl = await getResolvedXtreamStreamUrl(stream.kind, stream.id);
        remoteUrl.searchParams.set('source', upstreamUrl.toString());
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
    }

    if (file === 'index.m3u8') {
      ensureXtreamHls(streamId).catch(() => {});
      const ready = await waitForXtreamHlsIndex(streamId);
      if (!ready) {
        return NextResponse.json({ error: 'HLS stream is still preparing. Try again in a few seconds.' }, { status: 202, headers: CORS_HEADERS });
      }
    }

    const hlsFile = await getXtreamHlsFile(streamId, file);
    if (!hlsFile) {
      return NextResponse.json({ error: 'HLS file not found' }, { status: 404, headers: CORS_HEADERS });
    }

    return new NextResponse(Readable.toWeb(hlsFile.stream) as any, {
      status: 200,
      headers: {
        'content-type': hlsFile.contentType,
        'content-length': String(hlsFile.contentLength),
        'cache-control': file.endsWith('.m3u8') ? 'no-store' : 'public, max-age=3600',
        ...CORS_HEADERS,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'HLS conversion failed' }, { status: 502, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
