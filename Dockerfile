FROM node:20-slim

RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    ffmpeg \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# Copy sql.js WASM file to the build output location
RUN mkdir -p /app/public && \
    cp node_modules/sql.js/dist/sql-wasm.wasm /app/public/ || true

ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_DISCORD_CLIENT_ID
ARG NEXT_PUBLIC_TWITCH_CLIENT_ID
ARG NEXT_PUBLIC_LIVEKIT_URL

RUN NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_DISCORD_CLIENT_ID=$NEXT_PUBLIC_DISCORD_CLIENT_ID \
    NEXT_PUBLIC_TWITCH_CLIENT_ID=$NEXT_PUBLIC_TWITCH_CLIENT_ID \
    NEXT_PUBLIC_LIVEKIT_URL=$NEXT_PUBLIC_LIVEKIT_URL \
    npx next build

EXPOSE 3001

ENV NODE_ENV=production
ENV DB_FILE=/data/app.db
ENV MUSIC_CACHE_DIR=/data/music
ENV PORT=3001

CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3001"]
