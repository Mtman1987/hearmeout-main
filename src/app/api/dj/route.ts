import { NextRequest, NextResponse } from 'next/server';
import { startDJ, stopDJ, isDJRunning, getActiveInstances } from '@/lib/dj-service';

export async function POST(request: NextRequest) {
  try {
    const { action, roomId } = await request.json();

    if (!roomId) {
      return NextResponse.json({ error: 'roomId required' }, { status: 400 });
    }

    if (action === 'start') {
      const result = await startDJ(roomId);
      return NextResponse.json(result, { status: result.success ? 200 : 503 });
    }

    if (action === 'stop') {
      const result = await stopDJ(roomId);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Invalid action. Use "start" or "stop".' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get('roomId');

  if (roomId) {
    return NextResponse.json({ running: isDJRunning(roomId) });
  }

  return NextResponse.json({ instances: getActiveInstances() });
}
