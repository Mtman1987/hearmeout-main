import { NextRequest, NextResponse } from 'next/server';

const PIPED_INSTANCES = [
  "https://piped.video",
  "https://pipedapi.kavin.rocks",
  "https://piped.mha.fi",
  "https://piped.privacydev.net",
  "https://piped-api.garudalinux.org", // Additional backup instance
  "https://api.piped.projectsegfau.lt"  // Another backup
];

const TIMEOUT_MS = 5000; // 5 second timeout per instance

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
  } catch {
    return null;
  }
  return null;
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getYoutubeAudioUrl(youtubeUrl: string) {
  console.log("Incoming URL for audio processing:", youtubeUrl);

  const videoId = extractVideoId(youtubeUrl);
  console.log("Extracted video ID:", videoId);

  if (!videoId) throw new Error("Invalid YouTube URL or failed to extract Video ID");

  const errors: string[] = [];

  for (const instance of PIPED_INSTANCES) {
    try {
      const apiUrl = `${instance}/streams/${videoId}`;
      console.log(`Trying Piped instance: ${apiUrl}`);

      const res = await fetchWithTimeout(apiUrl, TIMEOUT_MS);

      if (!res.ok) {
        const errorMsg = `HTTP ${res.status} from ${instance}`;
        console.warn(errorMsg);
        errors.push(errorMsg);
        continue;
      }

      const data = await res.json();
      
      if (!data.audioStreams?.length) {
        const errorMsg = `No audio streams found from ${instance}`;
        console.warn(errorMsg);
        errors.push(errorMsg);
        continue;
      }

      // Sort by bitrate to get the best quality
      const best = data.audioStreams.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      
      if (!best?.url) {
        const errorMsg = `No valid audio URL from ${instance}`;
        console.warn(errorMsg);
        errors.push(errorMsg);
        continue;
      }

      console.log(`Successfully resolved audio URL from ${instance}:`, best.url);

      return {
        url: best.url,
        bitrate: best.bitrate || 0,
        codec: best.codec || 'unknown',
        source: instance,
        videoId: videoId
      };
    } catch (err: any) {
      const errorMsg = `Piped instance ${instance} failed: ${err.message}`;
      console.warn(errorMsg);
      errors.push(errorMsg);
      continue;
    }
  }

  console.error("All Piped instances failed. Errors:", errors);
  throw new Error(`Unable to resolve audio stream for video ${videoId}. All backends returned errors.`);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  const proxy = searchParams.get('proxy'); // Check if requesting proxied audio
  const retryCount = parseInt(searchParams.get('retry') || '0', 10);
  const maxRetries = 2;

  if (!url) {
    return NextResponse.json({ error: "Missing url query parameter" }, { status: 400 });
  }

  try {
    const result = await getYoutubeAudioUrl(url as string);
    
    // If client requests proxied audio (adds CORS headers), proxy it
    if (proxy === 'true') {
      console.log("Proxying audio stream through Next.js endpoint");
      try {
        const audioRes = await fetchWithTimeout(result.url, TIMEOUT_MS);
        if (!audioRes.ok) {
          throw new Error(`Failed to fetch audio: HTTP ${audioRes.status}`);
        }

        // Forward with proper CORS headers
        const buffer = await audioRes.arrayBuffer();
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            'Content-Type': audioRes.headers.get('content-type') || 'audio/mp4',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Cache-Control': 'public, max-age=3600',
            'Content-Length': buffer.byteLength.toString(),
          },
        });
      } catch (proxyError) {
        console.error("Proxy error:", proxyError);
        return NextResponse.json(
          { error: "Failed to proxy audio stream" },
          { status: 500 }
        );
      }
    }

    // Return metadata with both direct and proxied options
    return NextResponse.json({
      ...result,
      directUrl: result.url, // Direct URL (CORS depends on Piped)
      proxiedUrl: `/api/youtube-audio?url=${encodeURIComponent(url)}&proxy=true`, // Via our server
    });
  } catch (e: any) {
    console.error(`Failed attempt ${retryCount + 1}:`, e.message);
    
    // Return error with retry hint for client
    const status = retryCount < maxRetries ? 502 : 500;
    return NextResponse.json(
      { 
        error: e.message,
        canRetry: retryCount < maxRetries,
        retryCount: retryCount + 1
      }, 
      { status }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
