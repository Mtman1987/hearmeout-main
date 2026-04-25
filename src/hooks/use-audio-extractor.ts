'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

interface UseAudioExtractorOptions {
  videoId: string | null;
  onExtracted: (audioUrl: string) => void;
  onError: (error: string) => void;
  onStatus: (status: string) => void;
}

export function useAudioExtractor({ videoId, onExtracted, onError, onStatus }: UseAudioExtractorOptions) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const observerRef = useRef<PerformanceObserver | null>(null);
  const [extracting, setExtracting] = useState(false);

  const extract = useCallback(async () => {
    if (!videoId || extracting) return;

    // Check cache first
    try {
      const cacheCheck = await fetch(`/api/youtube-audio?videoId=${videoId}`);
      const cacheData = await cacheCheck.json();
      if (cacheData.cached && cacheData.audioUrl) {
        onStatus('cached');
        onExtracted(cacheData.audioUrl);
        return;
      }
    } catch {}

    setExtracting(true);
    onStatus('Extracting audio...');

    // Create hidden iframe with YouTube embed
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:1px;height:1px;position:absolute;left:-9999px;';
    iframe.allow = 'autoplay';
    iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1`;
    document.body.appendChild(iframe);
    iframeRef.current = iframe;

    // Watch for googlevideo.com audio requests via PerformanceObserver
    let found = false;

    // Method 1: Check performance entries for resource loads
    const checkEntries = () => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      for (const entry of entries) {
        if (entry.name.includes('googlevideo.com') && entry.name.includes('mime=audio')) {
          if (!found) {
            found = true;
            handleFound(entry.name);
          }
          return;
        }
      }
    };

    // Method 2: PerformanceObserver for real-time monitoring
    try {
      observerRef.current = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name.includes('googlevideo.com') && entry.name.includes('mime=audio') && !found) {
            found = true;
            handleFound(entry.name);
          }
        }
      });
      observerRef.current.observe({ entryTypes: ['resource'] });
    } catch {}

    // Poll for entries as backup
    const pollInterval = setInterval(checkEntries, 500);

    // Timeout after 15 seconds
    const timeout = setTimeout(() => {
      if (!found) {
        cleanup();
        onStatus('Extraction timeout — trying direct play');
        onError('Could not extract audio URL from YouTube');
        // Fall back to YouTube embed audio
        onExtracted(`https://www.youtube.com/embed/${videoId}?autoplay=1`);
      }
    }, 15000);

    function handleFound(audioUrl: string) {
      cleanup();
      onStatus('Downloading to server...');

      // Send the extracted URL to the server for download + cache
      fetch('/api/youtube-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, audioUrl }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.audioUrl) {
            onStatus(data.cached ? 'cached' : 'streaming');
            onExtracted(data.audioUrl);
          } else {
            // Direct URL still works for streaming even if cache failed
            onExtracted(audioUrl);
          }
        })
        .catch(() => {
          // Use the direct URL as fallback
          onExtracted(audioUrl);
        });
    }

    function cleanup() {
      clearInterval(pollInterval);
      clearTimeout(timeout);
      if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null; }
      if (iframeRef.current) { iframeRef.current.remove(); iframeRef.current = null; }
      setExtracting(false);
    }

    // Cleanup on unmount
    return cleanup;
  }, [videoId, extracting, onExtracted, onError, onStatus]);

  // Auto-extract when videoId changes
  useEffect(() => {
    if (videoId) extract();
    return () => {
      if (iframeRef.current) { iframeRef.current.remove(); iframeRef.current = null; }
      if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null; }
    };
  }, [videoId]);

  return { extracting };
}
