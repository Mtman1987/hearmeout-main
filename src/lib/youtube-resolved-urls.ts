declare global {
  var __youtubeResolvedUrls: Map<string, { videoUrl: string; audioUrl: string; resolvedAt: number }> | undefined;
}

export const resolvedUrls = globalThis.__youtubeResolvedUrls || new Map();
globalThis.__youtubeResolvedUrls = resolvedUrls;

export const MAX_AGE_MS = 5 * 60 * 60 * 1000; // 5 hours (YouTube URLs expire ~6h)
export function getResolvedYoutubeUrls(videoId: string) {
  const entry = resolvedUrls.get(videoId);
  if (!entry) return null;
  if (Date.now() - entry.resolvedAt > MAX_AGE_MS) {
    resolvedUrls.delete(videoId);
    return null;
  }
  return entry;
}

