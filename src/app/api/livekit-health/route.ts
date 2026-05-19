import { NextResponse } from 'next/server';

export async function GET() {
  const required = {
    LIVEKIT_API_KEY: !!process.env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: !!process.env.LIVEKIT_API_SECRET,
    NEXT_PUBLIC_LIVEKIT_URL: !!process.env.NEXT_PUBLIC_LIVEKIT_URL,
    LIVEKIT_URL: !!process.env.LIVEKIT_URL,
  };

  const isConfigured =
    !!process.env.LIVEKIT_API_KEY &&
    !!process.env.LIVEKIT_API_SECRET &&
    (!!process.env.NEXT_PUBLIC_LIVEKIT_URL || !!process.env.LIVEKIT_URL);

  return NextResponse.json({
    isConfigured,
    required,
  });
}

