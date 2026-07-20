'use client';

export interface ExtractedAudioInfo {
  url: string;
  mimeType: string;
  duration: number;
  title: string;
  artist: string;
}

const ALLOWED_AUDIO_HOSTS = ['googlevideo.com', 'youtube.com'];
function isAllowedAudioUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_AUDIO_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
  } catch {
    return false;
  }
}

/**
 * Resolve audio for a YouTube video using the browser's own authenticated
 * YouTube session. Loads the watch page in a hidden iframe, reads
 * ytInitialPlayerResponse from the iframe's contentWindow, and picks the
 * best audio-only adaptive format — no server-side extraction needed.
 *
 * Falls back to the server-side worker extractor if the iframe approach fails
 * (e.g. YouTube blocks iframe embedding for this video).
 */
export async function extractAudioUrl(videoId: string): Promise<ExtractedAudioInfo | null> {
  // 1. Try browser-native extraction via hidden iframe (uses user's YT session)
  try {
    const result = await extractViaBrowserIframe(videoId);
    if (result) return result;
  } catch (err) {
    console.warn('[YT Extract] iframe extraction failed, falling back to server:', err);
  }

  // 2. Fall back to server-side worker extractor
  try {
    const res = await fetch(`/api/youtube-audio?videoId=${encodeURIComponent(videoId)}`, {
      credentials: 'include',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.url) {
      console.error('[YT Extract] Server fallback failed for', videoId, data?.error || res.status);
      return null;
    }
    return data as ExtractedAudioInfo;
  } catch (err) {
    console.error('[YT Extract] Error:', err);
    return null;
  }
}

function extractViaBrowserIframe(videoId: string): Promise<ExtractedAudioInfo | null> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
    // embed URL suppresses the player UI and is less likely to trigger consent walls
    iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=0&enablejsapi=1`;
    iframe.allow = 'autoplay';
    // sandbox allows scripts but blocks popups/navigation away from the page
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

    let settled = false;
    const cleanup = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    }, 12000);

    iframe.onload = () => {
      if (settled) return;
      // Poll for ytInitialPlayerResponse — it may not be set synchronously
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        try {
          const win = iframe.contentWindow as any;
          const yip = win?.ytInitialPlayerResponse;
          if (!yip) {
            if (attempts >= 20) {
              clearInterval(poll);
              if (!settled) { settled = true; clearTimeout(timeout); cleanup(); resolve(null); }
            }
            return;
          }
          clearInterval(poll);
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          cleanup();

          const details = yip.videoDetails || {};
          const formats: any[] = [
            ...(yip.streamingData?.adaptiveFormats || []),
            ...(yip.streamingData?.formats || []),
          ];

          const audioFormats = formats
            .filter((f) => {
              const mime = String(f.mimeType || '');
              return mime.startsWith('audio/') && typeof f.url === 'string';
            })
            .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));

          const best = audioFormats[0];
          if (!best || !isAllowedAudioUrl(best.url)) {
            resolve(null);
            return;
          }

          resolve({
            url: best.url,
            mimeType: String(best.mimeType || 'audio/mp4').split(';')[0].trim(),
            duration: Number(details.lengthSeconds || 0),
            title: String(details.title || 'Unknown'),
            artist: String(details.author || 'Unknown'),
          });
        } catch {
          // cross-origin access blocked — iframe approach won't work
          clearInterval(poll);
          if (!settled) { settled = true; clearTimeout(timeout); cleanup(); resolve(null); }
        }
      }, 300);
    };

    iframe.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      resolve(null);
    };

    document.body.appendChild(iframe);
  });
}
