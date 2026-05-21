FROM node:22-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    chromium \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY worker/package*.json ./
RUN npm ci --omit=dev

COPY worker/src ./src

RUN mkdir -p /tmp/music

EXPOSE 3002

ENV NODE_ENV=production
ENV PORT=3002
ENV MUSIC_CACHE_DIR=/tmp/music

CMD ["node", "src/server.js"]
