// Strict YouTube video ID validator.
// YouTube IDs are exactly 11 characters from [A-Za-z0-9_-].
// This guards against command injection, path traversal, and URL-injection
// when a videoId is about to be passed to a shell, file path, or external URL.
export const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function isValidVideoId(videoId: unknown): videoId is string {
  return typeof videoId === 'string' && YOUTUBE_VIDEO_ID_RE.test(videoId);
}

export function assertValidVideoId(videoId: unknown): string {
  if (!isValidVideoId(videoId)) {
    throw new Error('invalid videoId');
  }
  return videoId;
}
