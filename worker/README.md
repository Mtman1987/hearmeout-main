# HearMeOut DJ Worker

This is the separate DJ worker service for HearMeOut. It handles:
- Music lookup and scraping via Puppeteer
- Audio download and conversion
- Streaming to the main app
- Puppeteer-based browser automation

## API Endpoints

All endpoints require Bearer token authentication via the `Authorization` header.

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

- `DJ_WORKER_SECRET` — Bearer token for API authentication
- `APP_URL` — Main app URL (defaults to `https://hearmeout-main.fly.dev`)
- `PORT` — Server port (defaults to 3002)
- `NODE_ENV` — Environment (defaults to `development`)

## Deployment

Deploy to Fly.io using:
```bash
flyctl deploy --config worker/fly.toml
```

Make sure `FLY_API_TOKEN_WORKER` is set in GitHub Secrets for CI/CD deployment.
