# HearMeOut DJ Worker

This is the separate DJ worker service for HearMeOut. It handles:
- Browser-based YouTube audio extraction via Chromium
- Browser DJ publishing through the main app's LiveKit/PeerJS path
- Fallback metadata and audio URL lookup through youtubei.js

## API Endpoints

### `POST /dj`
Start or stop a DJ instance.

**Request:**
```json
{
  "action": "start" | "stop",
  "roomId": "room-123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "DJ started."
}
```

### `GET /dj`
Check DJ status or list all active instances.

**Query Parameters:**
- `roomId` (optional) — Check if a specific room's DJ is running

**Response (with roomId):**
```json
{
  "running": true
}
```

**Response (without roomId):**
```json
{
  "instances": [
    { "roomId": "room-123", "startedAt": "2024-01-01T00:00:00.000Z" }
  ]
}
```

### `GET /health`
Health check endpoint (no auth required).

**Response:**
```json
{
  "status": "ok",
  "uptime": 12345.67
}
```

## Environment Variables

- `APP_URL` — Main app URL (defaults to `https://hearmeout-main.fly.dev`)
- `PORT` — Server port (defaults to 3002)
- `NODE_ENV` — Environment (defaults to `development`)
- `UPSTREAM_EXTRACTOR_URL` — Optional public URL for `local-extractor.js`
- `UPSTREAM_EXTRACTOR_SECRET` — Optional bearer token for the upstream extractor

## Deployment

Deploy to Fly.io using:
```bash
flyctl deploy --config worker/fly.toml
```

Make sure `FLY_API_TOKEN_WORKER` is set in GitHub Secrets for CI/CD deployment.
