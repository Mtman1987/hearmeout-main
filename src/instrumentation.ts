export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Bootstrap both bot surfaces through their read-only routes using the
    // existing machine credential. Middleware accepts it only for these GETs.
    const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
    const bootKey = String(process.env.HMO_WORKER_SHARED_SECRET || '').trim();
    if (!bootKey) {
      console.error('[Auto-Init] HMO_WORKER_SHARED_SECRET is required for bot startup');
      return;
    }
    const headers = { 'x-hmo-bot-boot-key': bootKey };

    setTimeout(async () => {
      try {
        const res = await fetch(`${baseUrl}/api/twitch-bot`, { headers });
        const data = await res.json().catch(() => null) as any;
        if (!res.ok) {
          console.log(`[Auto-Init] Twitch bot boot failed: ${res.status} ${data?.error || data?.message || 'authenticated request required'}`);
        } else {
          const instances = data?.instances && typeof data.instances === 'object'
            ? Object.values(data.instances) as Array<{ connected?: boolean }>
            : [];
          const connectedCount = instances.filter((instance) => instance?.connected === true).length;
          console.log('[Auto-Init] Twitch bot status:', data?.status || 'unknown', '| Connected instances:', connectedCount, '/', data?.serverCount ?? instances.length);
        }
      } catch {
        console.log('[Auto-Init] Twitch bot boot request failed');
      }

      try {
        const res = await fetch(`${baseUrl}/api/discord-bot`, { headers });
        const data = await res.json().catch(() => null) as any;
        if (!res.ok) {
          console.log(`[Auto-Init] Discord bot boot failed: ${res.status} ${data?.error || data?.message || 'authenticated request required'}`);
        } else {
          console.log('[Auto-Init] Discord bot status:', data?.status || 'unknown', '| Listeners:', data?.listenerCount ?? 0);
        }
      } catch {
        console.log('[Auto-Init] Discord bot boot request failed');
      }
    }, 5000);
  }
}
