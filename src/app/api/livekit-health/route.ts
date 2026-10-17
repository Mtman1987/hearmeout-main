import { NextResponse } from 'next/server';

export async function GET() {
  const hasApiKey = Boolean(process.env.LIVEKIT_API_KEY?.trim());
  const hasApiSecret = Boolean(process.env.LIVEKIT_API_SECRET?.trim());
  const hasUrl = Boolean(
    process.env.NEXT_PUBLIC_LIVEKIT_URL?.trim() || process.env.LIVEKIT_URL?.trim(),
  );
  const isConfigured = hasApiKey && hasApiSecret && hasUrl;

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
      },
    },
    {
      status: isConfigured ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
