FROM node:22-slim

RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    ffmpeg \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

RUN yt-dlp --version

WORKDIR /app

COPY worker/package*.json ./
RUN npm ci --omit=dev

COPY worker/src ./src

# Runtime hotfix: direct YouTube URL extraction can fail from Fly/cloud IPs.
# Fall back to downloading/caching with yt-dlp, then play the cached file.
RUN python3 - <<'PY'
from pathlib import Path
p = Path('/app/src/server.js')
s = p.read_text()
old = """    if (!audioUrl) {
      console.error(`[DJ:${this.roomId}] Failed to extract URL for ${videoId}, skipping`);
      await this.patchRoom({ djStatus: `Failed: ${videoId}` });
      setTimeout(() => this.advanceTrack(roomData), 500);
      return;
    }
    setCachedExtractedUrl(videoId, audioUrl);

    console.log(`[DJ:${this.roomId}] Streaming ${videoId} from URL`);
    this.playing = true;
    this._spawnFfmpeg(audioUrl, roomData);
"""
new = """    if (!audioUrl) {
      console.warn(`[DJ:${this.roomId}] Direct extraction failed for ${videoId}; trying yt-dlp cache fallback`);
      await this.patchRoom({ djStatus: `Downloading: ${videoId}` });
      const downloaded = await ripAndCache(videoId);
      let downloadedPath = join(CACHE_DIR, `${videoId}.m4a`);
      if (!existsSync(downloadedPath)) downloadedPath = join(CACHE_DIR, `${videoId}.mp3`);
      if (downloaded && existsSync(downloadedPath)) {
        console.log(`[DJ:${this.roomId}] Playing downloaded cache ${downloadedPath}`);
        await this.patchRoom({ djStatus: `Playing cached: ${videoId}` });
        return this._playFile(downloadedPath, roomData);
      }
      console.error(`[DJ:${this.roomId}] Failed to extract or download ${videoId}, skipping`);
      await this.patchRoom({ djStatus: `Failed to load: ${videoId}` });
      setTimeout(() => this.advanceTrack(roomData), 500);
      return;
    }
    setCachedExtractedUrl(videoId, audioUrl);

    console.log(`[DJ:${this.roomId}] Streaming ${videoId} from URL`);
    this.playing = true;
    this._spawnFfmpeg(audioUrl, roomData);
"""
if old not in s:
    raise SystemExit('Expected worker playback block not found')
p.write_text(s.replace(old, new))
PY

RUN mkdir -p /tmp/music

EXPOSE 3002

ENV NODE_ENV=production
ENV PORT=3002
ENV MUSIC_CACHE_DIR=/tmp/music

CMD ["sh", "-c", "yt-dlp -U 2>/dev/null; exec node src/server.js"]