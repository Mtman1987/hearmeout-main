// Shared in-memory cache of extracted YouTube audio URLs.
// Both /api/youtube-audio and /api/youtube-audio/stream reference
// the same Map so an extraction done in one route is immediately
// visible to the other.

const urlCache = new Map<string, { url: string; expires: number }>();

export function getExtractedUrl(videoId: string): string | null {
  const cached = urlCache.get(videoId);
  if (cached && cached.expires > Date.now()) return cached.url;
  return null;
}

export function setExtractedUrl(videoId: string, url: string): void {
  urlCache.set(videoId, { url, expires: Date.now() + 5 * 60 * 60 * 1000 });
}

export function deleteExtractedUrl(videoId: string): void {
  urlCache.delete(videoId);
}
