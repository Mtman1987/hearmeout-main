// Shared in-memory cache of extracted YouTube audio URLs.
// Both /api/youtube-audio and /api/youtube-audio/stream reference
// the same Map so an extraction done in one route is immediately
// visible to the other.

const urlCache = new Map<string, { url: string; expires: number }>();
const MAX_CACHE_SIZE = 500;

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of urlCache) {
    if (entry.expires <= now) urlCache.delete(key);
  }
}

// Periodically clean up expired entries (every 10 minutes)
setInterval(evictExpired, 10 * 60 * 1000).unref();

export function getExtractedUrl(videoId: string): string | null {
  const cached = urlCache.get(videoId);
  if (cached && cached.expires > Date.now()) return cached.url;
  if (cached) urlCache.delete(videoId);
  return null;
}

export function setExtractedUrl(videoId: string, url: string): void {
  if (urlCache.size >= MAX_CACHE_SIZE) evictExpired();
  if (urlCache.size >= MAX_CACHE_SIZE) {
    const oldest = urlCache.keys().next().value;
    if (oldest !== undefined) urlCache.delete(oldest);
  }
  urlCache.set(videoId, { url, expires: Date.now() + 5 * 60 * 60 * 1000 });
}

export function deleteExtractedUrl(videoId: string): void {
  urlCache.delete(videoId);
}
