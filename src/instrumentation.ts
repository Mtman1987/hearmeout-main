export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Auto-start bot surfaces when the route is reachable. These routes are
    // intentionally behind the SPMT session boundary, so a production boot
    // without an authenticated request may legitimately defer initialization.
    const baseUrl = `http://localhost:${process.env.PORT || 3001}`;

    setTimeout(async () => {
      try {
        const res = await fetch(`${baseUrl}/api/twitch-bot`);
        const data = await res.json().catch(() => null) as any;
        if (!res.ok) {
          console.log(`[Auto-Init] Twitch bot deferred: ${res.status} ${data?.error || data?.message || 'authenticated request required'}`);
        } else {
          const instances = data?.instances && typeof data.instances === 'object'
            ? Object.values(data.instances) as Array<{ connected?: boolean }>
            : [];
          const connectedCount = instances.filter((instance) => instance?.connected === true).length;
          console.log('[Auto-Init] Twitch bot status:', data?.status || 'unknown', '| Connected instances:', connectedCount, '/', data?.serverCount ?? instances.length);
        }
      } catch {
        console.log('[Auto-Init] Twitch bot init will happen on first authenticated request');
      }

      try {
        const res = await fetch(`${baseUrl}/api/discord-bot`);
        const data = await res.json().catch(() => null) as any;
        if (!res.ok) {
          console.log(`[Auto-Init] Discord bot deferred: ${res.status} ${data?.error || data?.message || 'authenticated request required'}`);
        } else {
          console.log('[Auto-Init] Discord bot status:', data?.status || 'unknown', '| Listeners:', data?.listenerCount ?? 0);
        }
      } catch {
        console.log('[Auto-Init] Discord bot init will happen on first authenticated request');
      }
    }, 5000);
  }
}
