export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Auto-start the Twitch bot when the Next.js server starts
    const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
    
    // Wait a bit for the server to be ready, then trigger bot init
    setTimeout(async () => {
      try {
        const res = await fetch(`${baseUrl}/api/twitch-bot`);
        const data = await res.json();
        console.log('[Auto-Init] Twitch bot status:', data.status, '| Connected:', data.connected);
      } catch (e) {
        console.log('[Auto-Init] Twitch bot init will happen on first page load');
      }
    }, 5000);
  }
}
