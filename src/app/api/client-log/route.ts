import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.warn('[client-log]', {
      area: body?.area || 'unknown',
      message: body?.message || 'no message',
      roomId: body?.roomId || null,
      identity: body?.identity || null,
      userAgent: body?.userAgent || null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[client-log] failed to parse payload', error);
  }

  return NextResponse.json({ ok: true });
}
