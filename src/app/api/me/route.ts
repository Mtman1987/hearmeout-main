import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ user: null });
    // Ensure uid is always present (DB stores as 'id', session uses 'uid')
    const user = { ...session.user, uid: session.uid };
    return NextResponse.json({ user });
  } catch (error) {
    console.error('[api/me] Error:', error);
    return NextResponse.json({ user: null });
  }
}

