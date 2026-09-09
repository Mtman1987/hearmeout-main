FROM node:22-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    chromium \
    git \
    python3 \
    python3-pip \
    build-essential \
    && python3 -m pip install --no-cache-dir --break-system-packages -U yt-dlp bgutil-ytdlp-pot-provider==1.3.1 \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider \
    && cd /opt/bgutil-ytdlp-pot-provider/server \
    && npm ci \
    && npx tsc

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV YTDLP_BGUTIL_SERVER_HOME=/opt/bgutil-ytdlp-pot-provider/server

WORKDIR /app

COPY worker/package*.json ./
RUN npm ci --omit=dev

COPY worker/src ./src
COPY worker/scripts ./scripts
RUN node ./scripts/patch-voice-bridge-audio-state.cjs

RUN mkdir -p /tmp/music

EXPOSE 3002

ENV NODE_ENV=production
ENV PORT=3002
ENV MUSIC_CACHE_DIR=/tmp/music

CMD ["node", "-r", "./src/persona-bootstrap.js", "src/server.js"]
