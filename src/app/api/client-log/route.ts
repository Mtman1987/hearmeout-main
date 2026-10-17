import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.warn('[client-log]', {
      area: body?.area || 'unknown',
      message: body?.message || 'no message',
      name: body?.name || null,
      code: body?.code || null,
      status: body?.status || null,
      stack: body?.stack || null,
      roomId: body?.roomId || null,
      identity: body?.identity || null,
      // LiveKit connection diagnostics: host only, never tokens or credentials.
      livekitHost: body?.livekitHost || null,
      connectionState: body?.connectionState || null,
      initialState: body?.initialState || null,
      previousState: body?.previousState || null,
      nextState: body?.nextState || null,
      disconnectReason: body?.disconnectReason || null,
      disconnectReasonName: body?.disconnectReasonName || null,
      reason: body?.reason || null,
      reasonName: body?.reasonName || null,
      userAgent: body?.userAgent || null,
      clientTimestamp: body?.timestamp || null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[client-log] failed to parse payload', error);
  }

  return NextResponse.json({ ok: true });
}
