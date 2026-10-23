import { NextResponse } from 'next/server';
import { getXtreamCatalog, getXtreamStreamUrl } from '@/lib/watch/xtream-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

function safeContentType(value: string | null) {
  return String(value || 'unknown').split(';')[0].trim().slice(0, 100);
}

/**
 * Safe diagnostic probe: asks the configured provider for only the first 64
 * bytes of a VOD stream. The special "auto" ID selects the first real VOD
 * entry from the provider catalog, so users don't have to find numeric IDs.
 * Never returns the source URL or provider credentials.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ streamId: string }> },
) {
  const { streamId } = await context.params;
  const requestedId = String(streamId || '').trim();
  let id = '';
  let selectedTitle: string | undefined;

  if (requestedId.toLowerCase() === 'auto') {
    try {
      const catalog = await getXtreamCatalog();
      const candidate = catalog.find((item) => /^xtream-vod-\d+$/.test(item.id));
      if (!candidate) {
        return NextResponse.json({
          ok: false,
          error: 'No Xtream VOD movie was found in the configured catalog.',
          notes: ['The catalog lookup did not find a real VOD item to probe.', 'No provider URL or credentials are returned.'],
        }, { status: 200, headers: NO_STORE });
      }
      id = candidate.id.slice('xtream-vod-'.length);
      selectedTitle = candidate.title;
    } catch {
      return NextResponse.json({
        ok: false,
        error: 'Could not read the configured provider catalog.',
        notes: ['Check provider configuration and catalog availability.', 'No provider URL or credentials are returned.'],
      }, { status: 200, headers: NO_STORE });
    }
  } else {
    id = requestedId.replace(/[^0-9]/g, '');
    if (!id || id.length > 20 || id !== requestedId) {
      return NextResponse.json({ ok: false, error: 'Use "auto" or provide a numeric VOD stream ID.' }, { status: 400, headers: NO_STORE });
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response: Response | null = null;

  try {
    const source = await getXtreamStreamUrl('vod', id);
    response = await fetch(source, {
      method: 'GET',
      headers: { Range: 'bytes=0-63', 'User-Agent': 'HearMeOut-Direct-Playback-Probe/1.0' },
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });

    const contentType = safeContentType(response.headers.get('content-type'));
    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges');
    const reader = response.body?.getReader();
    let firstBytes = 0;
    let signature = 'unavailable';

    if (reader) {
      try {
        const chunk = await reader.read();
        if (!chunk.done && chunk.value) {
          firstBytes = Math.min(chunk.value.byteLength, 64);
          const bytes = chunk.value.slice(0, 16);
          signature = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    }

    const rangeHonored = response.status === 206 && Boolean(contentRange);
    const streamReturned = response.ok && firstBytes > 0;
    const looksLikePlaylist = contentType.includes('mpegurl') || contentType.includes('vnd.apple');
    const looksLikeVideo = contentType.startsWith('video/') || contentType === 'application/octet-stream';

    return NextResponse.json({
      ok: streamReturned,
      streamId: id,
      ...(selectedTitle ? { selectedTitle } : {}),
      upstreamStatus: response.status,
      contentType,
      contentLength: response.headers.get('content-length'),
      acceptRanges,
      contentRange,
      rangeHonored,
      firstBytesRead: firstBytes,
      firstBytesHex: signature,
      formatHint: looksLikePlaylist ? 'playlist/HLS' : looksLikeVideo ? 'video-or-binary' : 'unknown-content-type',
      directPlaybackSignal: streamReturned && !looksLikePlaylist && looksLikeVideo,
      notes: [
        'Provider URL and credentials are deliberately not returned.',
        'This probe reads at most the first response chunk and cancels the stream.',
        'A successful range probe does not prove browser CORS or codec compatibility.',
        looksLikePlaylist ? 'The provider appears to return a playlist for this item.' : 'This probe did not request or create HLS segments.',
      ],
    }, { status: 200, headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      streamId: id,
      ...(selectedTitle ? { selectedTitle } : {}),
      error: controller.signal.aborted ? 'Provider probe timed out after 8 seconds.' : 'Provider probe failed; check provider configuration and stream ID.',
      detail: error instanceof Error ? error.name : 'UnknownError',
      notes: ['No provider URL or credentials are returned.'],
    }, { status: 502, headers: NO_STORE });
  } finally {
    clearTimeout(timeout);
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}
