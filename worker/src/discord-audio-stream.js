const { Readable } = require('node:stream');
const CHUNK_SIZE = 64 * 1024;

// Relay the original Opus bytes. YouTube accepts bounded ranges while
// rejecting the browser's open-ended request; no encoding or HLS is needed.
async function streamDiscordAudio(req, res, resolve, fetchMedia = fetch) {
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const videoId = String(req.params.videoId || '');
  let info;
  async function piece(start, end) {
    const options = () => ({
      headers: { range: 'bytes=' + start + '-' + end },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    });
    let response = await fetchMedia(info.url, options());
    if ([401, 403].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      info = await resolve(videoId, true);
      response = await fetchMedia(info.url, options());
    }
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
    if (response.status !== 206 || !range || Number(range[1]) !== start) {
      void response.body?.cancel().catch(() => {});
      throw Error('Audio byte range unavailable');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== Number(range[2]) - start + 1 || Number(range[2]) > end) throw Error('Incomplete audio byte range');
    return { bytes, total: Number(range[3]) };
  }
  try {
    info = await resolve(videoId);
    const requested = req.headers.range;
    const match = requested && /^bytes=(\d*)-(\d*)$/.exec(requested);
    if (requested && (!match || (!match[1] && !match[2]))) return res.status(416).end();
    const start = match?.[1] ? Number(match[1]) : 0;
    const explicitEnd = match?.[1] && match[2] ? Number(match[2]) : null;
    if (!Number.isSafeInteger(start) || (explicitEnd !== null && (!Number.isSafeInteger(explicitEnd) || explicitEnd < start))) return res.status(416).end();
    let first = await piece(start, Math.min(start + CHUNK_SIZE - 1, explicitEnd ?? Infinity));
    const total = first.total;
    let offset = start;
    const end = Math.min(explicitEnd ?? total - 1, total - 1);
    if (match && !match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return res.status(416).end();
      offset = Math.max(0, total - suffix);
      first = await piece(offset, Math.min(offset + CHUNK_SIZE - 1, end));
    }
    res.setHeader('Content-Type', 'audio/webm; codecs="opus"');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', end - offset + 1);
    if (requested) res.setHeader('Content-Range', 'bytes ' + offset + '-' + end + '/' + total);
    res.status(requested ? 206 : 200);
    async function* chunks() {
      let current = first;
      while (offset <= end) {
        if (controller.signal.aborted) return;
        if (current.total !== total) throw Error('Audio source changed');
        yield current.bytes;
        offset += current.bytes.length;
        if (offset <= end) current = await piece(offset, Math.min(offset + CHUNK_SIZE - 1, end));
      }
    }
    const stream = Readable.from(chunks());
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(503).json({ error: 'Audio source unavailable' });
    else res.destroy();
  }
}
module.exports = { streamDiscordAudio, CHUNK_SIZE };
