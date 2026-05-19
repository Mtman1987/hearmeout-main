import { NextResponse } from 'next/server';
import { getXtreamStatus } from '@/lib/xtream-provider';

export async function GET() {
  try {
    return NextResponse.json(await getXtreamStatus());
  } catch (error: any) {
    return NextResponse.json({ configured: true, error: error.message || 'Xtream status failed' }, { status: 502 });
  }
}
