import { NextRequest, NextResponse } from 'next/server';
import { autoRadioNext } from '@/lib/bot-actions';
import { getSession } from '@/lib/auth';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session && !isDjWorkerRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { roomId } = await req.json();
    if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 });
    console.log('[AutoRadioAPI] request', { roomId, actor: session?.uid || 'dj-worker' });
    const result = await autoRadioNext(roomId);
    console.log('[AutoRadioAPI] result', { roomId, success: result.success, message: result.message });
    return NextResponse.json(result);
  } catch {
    console.error('[AutoRadioAPI] Internal error');
    return NextResponse.json({ success: false, message: 'Internal error' }, { status: 500 });
  }
}
