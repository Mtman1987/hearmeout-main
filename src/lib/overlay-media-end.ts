export function overlayEndTarget(input: {
  clean: boolean; lane: string; roomId: string; twitchTenant: string;
  sourceKey: string; sessionId: string; requestId: string;
}): { url: string; init?: RequestInit } | null {
  if (!input.clean || input.lane !== 'music' || !input.requestId) return null;
  if (input.twitchTenant && input.sourceKey) return {
    url: '/api/twitch-source/' + encodeURIComponent(input.twitchTenant) + '/ended',
    init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-source-key': input.sourceKey },
      body: JSON.stringify({ expectedRequestId: input.requestId }) },
  };
  if (input.roomId !== 'system-spacemountainlive-lounge') return null;
  return { url: '/api/watch/sessions/' + encodeURIComponent(input.sessionId)
    + '/quick-control?action=next&expectedRequestId=' + encodeURIComponent(input.requestId) + '&platform=room&format=json',
    init: { cache: 'no-store' } };
}

/** Keep completed media stopped while queue advancement is acknowledged/retried. */
export function createOverlayCompletionTracker(now: () => number = Date.now) {
  const completed = new Map<string, { pending: boolean; acknowledged: boolean; retryAt: number }>();
  return {
    hasEnded(id: string) { return Boolean(id && completed.has(id)); },
    markEnded(id: string) {
      if (id && !completed.has(id)) completed.set(id, { pending: false, acknowledged: false, retryAt: 0 });
    },
    async report(id: string, deliver: () => Promise<void>) {
      if (!id) return;
      this.markEnded(id);
      const entry = completed.get(id)!;
      if (entry.pending || entry.acknowledged || now() < entry.retryAt) return;
      entry.pending = true;
      try {
        await deliver();
        entry.acknowledged = true;
      } finally {
        entry.pending = false;
        entry.retryAt = now() + 3000;
      }
    },
    retain(id: string) {
      // Keep recent IDs so an older poll response cannot resurrect a finished song.
      for (const key of completed.keys()) {
        if (completed.size <= 32) break;
        if (key !== id && !completed.get(key)?.pending) completed.delete(key);
      }
    },
  };
}
