FROM node:22-slim

RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    ffmpeg \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer is no longer used for DJ streaming. These variables are left unset.

RUN yt-dlp --version

WORKDIR /app

COPY worker/package*.json ./
RUN npm ci --omit=dev

COPY worker/src ./src

EXPOSE 3002

ENV NODE_ENV=production
ENV PORT=3002
ENV MUSIC_CACHE_DIR=/data/music

CMD ["sh", "-c", "yt-dlp -U 2>/dev/null; exec node src/server.js"]
