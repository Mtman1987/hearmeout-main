import { NextResponse } from 'next/server';

export async function GET() {
  const hasApiKey = Boolean(process.env.LIVEKIT_API_KEY?.trim());
  const hasApiSecret = Boolean(process.env.LIVEKIT_API_SECRET?.trim());
  const hasBrowserUrl = Boolean(process.env.NEXT_PUBLIC_LIVEKIT_URL?.trim());
  const hasServerUrl = Boolean(process.env.LIVEKIT_URL?.trim());
  const hasUrl = hasBrowserUrl || hasServerUrl;
  // The browser connects directly, so a server-only LIVEKIT_URL is not enough.
  const isConfigured = hasApiKey && hasApiSecret && hasBrowserUrl;

  // This endpoint is intentionally safe for unauthenticated diagnostics:
  // report presence/configuration only, never credential values or raw URLs.
  return NextResponse.json(
    {
      ok: isConfigured,
      isConfigured,
      checks: {
        apiKeyPresent: hasApiKey,
        apiSecretPresent: hasApiSecret,
        urlPresent: hasUrl,
        browserUrlPresent: hasBrowserUrl,
        serverUrlPresent: hasServerUrl,
      },
    },
    {
      status: isConfigured ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
