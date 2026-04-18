// HearMeOut Local Extractor
// Runs on your PC — uses your residential IP for yt-dlp extraction
// Fly.io server calls this to get audio URLs, then proxies the audio itself

const http = require('http');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const PORT = 7777;
const SECRET = process.env.EXTRACTOR_SECRET || 'hmo-extract-2026';

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // Auth check
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${SECRET}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', extractor: 'local-yt-dlp' }));
    return;
  }

  // Extract: GET /extract?videoId=xxx
  if (req.url?.startsWith('/extract')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const videoId = url.searchParams.get('videoId');

    if (!videoId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'videoId required' }));
      return;
    }

    console.log(`[Extract] ${videoId}...`);

    try {
      const { stdout } = await execAsync(
        `yt-dlp --no-warnings -f "bestaudio[ext=m4a]/bestaudio" --get-url "https://www.youtube.com/watch?v=${videoId}"`,
        { timeout: 30000 }
      );

      const audioUrl = stdout.trim();
      if (audioUrl && audioUrl.startsWith('http')) {
        console.log(`[Extract] ✅ ${videoId} → got URL`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ videoId, url: audioUrl }));
      } else {
        console.log(`[Extract] ❌ ${videoId} → no URL`);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No audio URL found' }));
      }
    } catch (err) {
      console.error(`[Extract] ❌ ${videoId}:`, err.message?.slice(0, 200));
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message?.slice(0, 200) }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🎵 HearMeOut Local Extractor running on http://localhost:${PORT}`);
  console.log(`   Secret: ${SECRET}`);
  console.log(`   Expose with: npx localtunnel --port ${PORT} --subdomain hmo-extract`);
  console.log(`   Or use ngrok: ngrok http ${PORT}\n`);
});
