# HearMeOut — Road to Production

An ordered, actionable checklist of bugs, gaps, and hardening work found while
reviewing `hearmeout-main` (app + `worker/`). Do them top-to-bottom: security and
data-integrity blockers first, then reliability, then polish. Each item notes
**why it matters**, **where** it lives, and a **suggested fix**.

Legend: **P0** = must fix before/at production · **P1** = fix soon after ·
**P2** = polish / nice-to-have.

---

## 0. Discord Voice Bridge UI — hide behind a header icon toggle  ✅ DONE (this PR)

- **What:** The Discord Voice Bridge card used to always render in the room body
  for owners. It now hides behind a header icon (the `Radio` button next to the
  DJ music note), exactly like DJ (`showDJ`) and Chat toggles.
- **Where:** `src/app/rooms/[roomId]/page.tsx` (`RoomHeader`, `renderRoomUI`,
  new `showVoiceBridge` state) and `src/app/rooms/[roomId]/_components/VoiceBridgeCard.tsx`.
- **Status:** Implemented in this PR. Verify placement/behavior during testing.

---

## P0 — Security & data-integrity blockers

### 1. Internal worker endpoints trust a spoofable static header
- **Why it matters:** The app authorizes privileged internal calls purely on the
  header `x-hmo-dj-worker: '1'` (`src/lib/dj-worker-auth.ts`). Next.js API routes
  are **publicly reachable**, so anyone who sends that header can:
  - mint LiveKit tokens for any room (`/api/livekit-token` DJ/bridge branches),
  - write to the DB (`/api/db` POST/PATCH),
  - **read the Discord bot token** (`/api/discord/bot-token`, added for the bridge).
  The bot-token endpoint makes this the highest-value target — a leaked bot token
  = full control of the Discord bot.
- **Where:** `src/lib/dj-worker-auth.ts`, `src/app/api/livekit-token/route.ts`,
  `src/app/api/db/route.ts`, `src/app/api/discord/bot-token/route.ts`,
  `worker/src/server.js` (`WORKER_CALLBACK_HEADERS`).
- **Fix:** Replace the static header with a **shared secret** set on both apps
  (e.g. `WORKER_SHARED_SECRET`), compared with `crypto.timingSafeEqual`. Have the
  worker send `Authorization: Bearer <secret>`; have `isDjWorkerRequest` verify it.
  Bonus: restrict these routes to Fly private networking (call the app via
  `http://hearmeout-main.internal:3001`) and reject public-origin requests.

### 2. Worker HTTP endpoints are unauthenticated and public
- **Why it matters:** `authorizeWorker` in `worker/src/server.js` is a no-op, and
  the worker is exposed on a public Fly domain (`worker/fly.toml [http_service]`).
  Anyone can `POST /dj` or `POST /voice-bridge` with an arbitrary `roomId` to
  start/stop DJ sessions and voice bridges, burning CPU and joining Discord VCs.
- **Where:** `worker/src/server.js` (`authorizeWorker`, `/dj`, `/voice-bridge`).
- **Fix:** Implement `authorizeWorker` to require the same shared secret as item 1
  (from the app, which is the only legitimate caller). Optionally drop the public
  `http_service` and use Fly private networking only.

### 3. sql.js "shared DB" model is not safe across processes / instances
- **Why it matters:** The DB is an in-memory sql.js image loaded once and written
  back to a single file with a 500ms debounce (`src/lib/db.ts`). Consequences:
  - **Cross-app sharing is broken.** The comment says the file is "the same
    /data/app.db as DSH", but `hearmeout-main` and `DiscordStreamHub` are separate
    Fly apps with separate volumes — they cannot share one physical file. If auth
    users are written by DSH and read by HMO, verify how they actually reach HMO's
    DB, or logins silently fail (`getSession` returns null when the user row is
    absent). Two processes writing the same file would also corrupt it.
  - **No horizontal scaling.** A Fly volume attaches to one machine, and each
    machine would hold a divergent in-memory copy. The app is implicitly pinned to
    a single instance (`min_machines_running = 1`); document/enforce this.
  - **Crash-window data loss.** Up to 500ms of writes are lost on crash, and each
    save rewrites the whole file with no fsync/atomic-rename.
- **Where:** `src/lib/db.ts`, `fly.toml [mounts]`, cross-repo with DSH.
- **Fix (pick one):** migrate to a real shared store — **Turso/libSQL**,
  **Postgres**, or **LiteFS** (if you truly need SQLite shared across apps). At
  minimum: make saves atomic (write temp file + rename), and explicitly assert
  single-instance until migrated. Confirm the HMO↔DSH user-sync path.

### 4. Sync `db.get()` can run before the async DB init completes
- **Why it matters:** `db.get/set/...` return early (`null` / no-op) if `_db` is
  not yet initialized (`src/lib/db.ts`). Routes that call the sync API without
  first `await ensureDb()` can read null or silently drop writes during cold start.
- **Where:** `src/lib/db.ts`; audit all callers of `db.get/set/update`.
- **Fix:** Ensure every route `await ensureDb()` before sync DB access (many
  already do), or make the sync methods throw if uninitialized so gaps surface.

---

## P1 — Reliability & correctness

### 5. Voice bridge does not survive worker restarts / redeploys
- **Why it matters:** Bridge state lives only in the worker's memory
  (`worker/src/discord-voice-bridge.js`, `bridges` map). On redeploy (which happens
  on every push to `main`) all bridges stop, but `room.voiceBridge.enabled` stays
  `true` in the DB, so the UI shows "Live" while nothing is running.
- **Fix:** On worker boot, reconcile: query rooms with `voiceBridge.enabled === true`
  and restart their bridges; or have the app re-issue `start` on a health signal.
  Also surface true worker status in the UI (the card already reads `/voice-bridge`
  status — make the toggle reflect `worker.running`, not just persisted `enabled`).

### 6. Voice connection has no reconnect / disconnect handling
- **Why it matters:** If the Discord voice `VoiceConnection` drops
  (`VoiceConnectionStatus.Disconnected`) the bridge silently dies with no retry.
- **Where:** `worker/src/discord-voice-bridge.js` (`start`).
- **Fix:** Listen for `Disconnected`/`Destroyed` and attempt `entersState`
  reconnection (Signalling/Connecting) a few times before tearing down and marking
  the bridge stopped in the DB.

### 7. Per-speaker LiveKit connections can be heavy; no lifecycle cap
- **Why it matters:** The bridge opens one LiveKit `Room` connection **per Discord
  speaker** plus one listener connection. A busy VC = many concurrent connections
  and opus decoders on the worker.
- **Fix:** Consider publishing multiple Discord speakers through a **single** LiveKit
  connection with multiple tracks, or cap concurrent speakers. Tear down idle pipes
  after N seconds of silence (currently pipes persist until the user leaves the VC).

### 8. One bot can only occupy one voice channel per guild
- **Why it matters:** Two rooms bridging the **same guild** to different channels
  will fight over the single bot connection.
- **Fix:** Guard against starting a second bridge for a guild already bridged;
  return a clear error to the owner.

### 9. `AudioSource.captureFrame` is fire-and-forget
- **Why it matters:** In `DiscordUserPipe.onPcm` frames are captured without
  awaiting/backpressure, which can reorder or overrun under load.
- **Fix:** Use the same queue+drain pattern the DJ path uses
  (`worker/src/server.js` `drainQueue`), or await sequentially.

### 10. Discord REST channel/guild calls have no rate-limit handling
- **Why it matters:** `/api/discord/channels`, `/api/discord/guilds`, and
  `member.fetch` in the bridge can hit Discord 429s with no backoff.
- **Fix:** Respect `Retry-After`; cache guild/channel/member lookups (channels
  route already caches 5min — extend to guilds and member avatar/name).

---

## P2 — Polish, DX, and observability

### 11. Repo-wide lint is red
- **Why it matters:** `npm run lint` reports ~108 errors / ~285 warnings
  (mostly `no-unused-vars`, `no-console`). Lint is effectively unenforced, so real
  issues can hide.
- **Fix:** Fix or explicitly downgrade rules, then wire `lint` + `typecheck` into
  CI (currently `.github/workflows/fly-deploy.yml` only deploys — no build gate).

### 12. No CI build/test gate before deploy
- **Why it matters:** Every push to `main` deploys both apps with no prior
  `typecheck`/`build`/lint gate. A broken build ships.
- **Fix:** Add a `ci.yml` that runs `npm ci && npm run typecheck && npm run build`
  (and worker `node -c`) on PRs and blocks merge.

### 13. Bridge worker dependencies add native build surface
- **Why it matters:** `@discordjs/opus` compiles natively; the Dockerfile now
  installs `build-essential` for it. Build failures would break worker deploys.
- **Fix:** Pin versions (done: `discord.js@14.26.5`), and consider `opusscript`
  (pure-JS) as a fallback if prebuilds are unavailable. Watch worker image size.

### 14. Observability
- **Why it matters:** Failures in the bridge/DJ are only visible in Fly logs.
- **Fix:** Add lightweight metrics/health details (active bridges, speakers,
  reconnect counts) to `/health` and surface bridge errors back to the room owner
  via a toast/status.

### 15. Secrets & env verification
- **Fix:** Confirm production secrets exist: `HEARMEOUT_JWT_SECRET`,
  `LIVEKIT_API_KEY`/`SECRET`, `DISCORD_BOT_TOKEN` (on the app),
  and the new shared worker secret (items 1–2). `src/lib/config.ts` logs but does
  not fail hard on missing prod secrets — consider a startup self-check endpoint.

---

## Suggested execution order

1. **Item 0** (done) — verify in testing.
2. **Items 1 & 2** — shared secret for app↔worker; lock down bot-token + worker endpoints.
3. **Item 3** — decide DB strategy (or formally pin single-instance) and confirm HMO↔DSH auth sync.
4. **Item 4** — audit `ensureDb()` usage.
5. **Items 5–6** — bridge restart reconciliation + reconnect handling.
6. **Items 7–10** — bridge resource/lifecycle + rate limits.
7. **Items 11–12** — lint cleanup + CI gate.
8. **Items 13–15** — deps, observability, secret checks.
