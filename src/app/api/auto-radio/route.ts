import { NextRequest, NextResponse } from 'next/server';
import { autoRadioNext } from '@/lib/bot-actions';

export async function POST(req: NextRequest) {
  try {
    const { roomId } = await req.json();
    if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 });
    const result = await autoRadioNext(roomId);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ success: false, message: 'Internal error' }, { status: 500 });
  }
}
