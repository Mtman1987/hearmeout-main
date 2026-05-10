import { NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { setSessionCookie } from '@/lib/auth';

export async function POST() {
  await ensureDb(); // Wait for DB to initialize
  // Reuse a stable dev guest so we don't create a new user every time
  const uid = process.env.NODE_ENV === 'development' ? 'dev_local_user' : `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.set('users', uid, {
    id: uid,
    username: 'Guest',
    displayName: 'Guest User',
    email: null,
    photoURL: null,
    isAnonymous: true,
  });

  await setSessionCookie(uid);

  return NextResponse.json({ success: true });
}
