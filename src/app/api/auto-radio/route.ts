import { NextRequest, NextResponse } from 'next/server';
import { autoRadioNext } from '@/lib/bot-actions';
import { getSession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { roomId } = await req.json();
    if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 });
    const result = await autoRadioNext(roomId);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ success: false, message: 'Internal error' }, { status: 500 });
  }
}
