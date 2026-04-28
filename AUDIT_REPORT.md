# Authentication & API Routes Audit Report

## Executive Summary

This audit identified **12 critical issues** and **8 improvements** needed to make the authentication and API routes work reliably. The app uses a custom JWT-based session system with DSH (Discord Stream Hub) as the auth authority, SQLite for local storage, and integrates with Twitch/Discord OAuth.

---

## Critical Issues

### 1. Missing Environment Variables Configuration
**Files affected:** All auth routes, API routes
**Issue:** No `.env.local` or `.env.example` file exists. Required env vars are:
- `JWT_SECRET` or `DISCORD_CLIENT_SECRET`
- `DB_API_KEY` (for DSH communication)
- `NEXT_PUBLIC_DISCORD_CLIENT_ID`
- `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `NEXT_PUBLIC_LIVEKIT_URL`
- `HARDCODED_GUILD_ID`
- `NEXT_PUBLIC_BASE_URL`

**Fix:** Create `.env.example` with all required variables documented.

### 2. Database Directory Not Created
**File:** `/workspace/src/lib/db.ts`
**Issue:** Line 11-14 creates directory but DB file path is `./data/app.db` which may not exist on first run.
**Impact:** Auth routes will fail on fresh deployment.

**Fix:** Ensure directory creation happens before any DB operation.

### 3. Session Cookie Security in Development
**File:** `/workspace/src/lib/auth.ts` (line 52)
**Issue:** `secure: process.env.NODE_ENV === 'production'` means cookies aren't secure in dev, but also won't work over HTTPS in staging.

**Fix:** Use `secure: process.env.NODE_ENV !== 'development'`

### 4. Missing Error Handling in Discord Callback
**File:** `/workspace/src/app/api/auth/discord/callback/route.ts` (lines 18-51)
**Issue:** If DSH token fetch fails, error is silently caught and user sees no feedback.
**Impact:** Users stuck in login loop with no error message.

**Fix:** Redirect to login page with error parameter when token fetch fails.

### 5. Race Condition in Auto-Login
**File:** `/workspace/src/app/api/auth/auto-login/route.ts` (lines 18-44)
**Issue:** Multiple concurrent requests could create duplicate user records.
**Impact:** Data inconsistency, potential auth failures.

**Fix:** Add check-and-set atomic operation or use transactions.

### 6. Hardcoded DSH URL Without Fallback
**Files:** Multiple auth routes
**Issue:** `DSH_URL = 'https://discord-stream-hub-new.fly.dev'` hardcoded everywhere.
**Impact:** Cannot deploy to different environments or use local DSH.

**Fix:** Use `process.env.DSH_URL` with hardcoded value as fallback.

### 7. Missing State Parameter Validation
**File:** `/workspace/src/app/api/auth/twitch/callback/route.ts` (line 36)
**Issue:** State parameter only checked for bot auth, not user auth flow.
**Security Risk:** CSRF vulnerability in OAuth flow.

**Fix:** Generate and validate state parameter for all OAuth flows.

### 8. JWT Secret Fallback is Insecure
**File:** `/workspace/src/lib/auth.ts` (line 10)
**Issue:** Falls back to `'hearmeout-dev-secret'` if no env var set.
**Security Risk:** Predictable secret in production if env vars missing.

**Fix:** Throw error if JWT_SECRET not set in production.

### 9. No Rate Limiting on Auth Endpoints
**Files:** All auth routes
**Issue:** No rate limiting on login/guest endpoints.
**Security Risk:** Brute force attacks possible.

**Fix:** Implement rate limiting middleware.

### 10. Guest User Cleanup Never Happens
**File:** `/workspace/src/app/api/auth/guest/route.ts`
**Issue:** Guest users created but never cleaned up.
**Impact:** Database bloat over time.

**Fix:** Add periodic cleanup job or TTL for guest users.

### 11. Async Operations Not Awaited Properly
**Files:** Multiple routes
**Issue:** `enrichUserFromDSH()` called with `.catch(() => {})` but errors silently swallowed.
**Impact:** User data may be stale without anyone knowing.

**Fix:** Log enrichment failures and implement retry mechanism.

### 12. Missing Content-Type Headers
**Files:** `/workspace/src/app/api/admin-chat/route.ts`, others
**Issue:** Some POST requests don't validate Content-Type header.
**Security Risk:** Potential CSRF or content injection.

**Fix:** Validate Content-Type is application/json for POST/PUT/PATCH.

---

## Recommended Improvements

### 1. Add Health Check Endpoint
Create `/api/auth/health` to verify:
- Database connection
- DSH connectivity
- JWT secret configured
- OAuth credentials present

### 2. Implement Session Refresh
**File:** `/workspace/src/lib/auth.ts`
**Issue:** Sessions last 30 days with no refresh mechanism.
**Fix:** Implement sliding session expiration.

### 3. Add Logging/Monitoring
All API routes should log:
- Auth attempts (success/failure)
- API errors with stack traces
- Performance metrics

### 4. Standardize Error Responses
Create error response utility for consistent format:
```json
{ "error": { "code": "AUTH_FAILED", "message": "...", "details?: {} } }
```

### 5. Add Request Validation
Use Zod or similar for request body validation in all POST endpoints.

### 6. Implement CORS Properly
Some routes may need explicit CORS headers for cross-origin requests.

### 7. Add Timeout Handling
DSH fetch calls should have timeout to prevent hanging requests.

### 8. Document API Contracts
Add OpenAPI/Swagger docs for all API endpoints.

---

## Files Requiring Immediate Attention

### High Priority (Security/Critical Bugs)
1. `/workspace/src/lib/auth.ts` - JWT secret validation, cookie security
2. `/workspace/src/app/api/auth/discord/callback/route.ts` - Error handling
3. `/workspace/src/app/api/auth/twitch/callback/route.ts` - State validation
4. `/workspace/src/app/api/auth/auto-login/route.ts` - Race condition
5. `/workspace/src/lib/db.ts` - DB initialization

### Medium Priority (Reliability)
6. `/workspace/src/app/api/auth/guest/route.ts` - Guest cleanup
7. `/workspace/src/app/api/admin-chat/route.ts` - Content-Type validation
8. `/workspace/src/app/api/me/route.ts` - Error responses
9. `/workspace/src/lib/enrich-user.ts` - Error logging

### Low Priority (Improvements)
10. All routes - Add rate limiting
11. All routes - Add structured logging
12. Create `.env.example`

---

## Testing Checklist

Before deploying fixes, verify:
- [ ] Fresh install creates database successfully
- [ ] Discord OAuth completes without errors
- [ ] Twitch OAuth completes without errors
- [ ] Guest login works
- [ ] Logout clears session properly
- [ ] Auto-login handles edge cases
- [ ] Session persists across page reloads
- [ ] Expired sessions are rejected
- [ ] Invalid JWT tokens are rejected
- [ ] DSH downtime doesn't crash auth
- [ ] Concurrent logins don't create duplicates

---

## Next Steps

1. Create `.env.example` file
2. Fix critical security issues (items 1-9 above)
3. Add proper error handling throughout
4. Implement monitoring/logging
5. Add comprehensive tests
6. Document all environment variables
7. Create deployment checklist

