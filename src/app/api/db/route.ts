import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isDjWorkerRequest } from '@/lib/dj-worker-auth';

// Collections accessible via the generic /api/db endpoint (matches firestore.rules).
// 'config' requires admin; all others require any authenticated session.
const ALLOWED_COLLECTIONS = new Set(['rooms', 'users']);
const ADMIN_COLLECTIONS = new Set(['config']);
const PROTECTED_USER_FIELDS = ['isAdmin'];

function sanitizeUserWrite(collection: string, data: Record<string, any>): Record<string, any> {
  if (collection !== 'users') return data;
  const cleaned = { ...data };
  for (const field of PROTECTED_USER_FIELDS) delete cleaned[field];
  return cleaned;
}

function isAllowedCollection(collection: string): 'allowed' | 'admin' | 'denied' {
  if (ALLOWED_COLLECTIONS.has(collection)) return 'allowed';
  // Room subcollections: rooms/{roomId}/{subcollection} (matches firestore.rules)
  if (/^rooms\/[^/]+\/[^/]+$/.test(collection)) return 'allowed';
  if (ADMIN_COLLECTIONS.has(collection)) return 'admin';
  return 'denied';
}

async function isAdmin(uid: string): Promise<boolean> {
  await ensureDb();
  const userDoc = db.get('users', uid);
  return !!userDoc?.isAdmin;
}

// Allow unauthenticated reads for public rooms (matches firestore.rules);
// all other collections require a session.
function isPublicRoomsRead(collection: string | null, filtersParam: string | null): boolean {
  if (collection !== 'rooms') return false;
  if (!filtersParam) return false;
  try {
    const filters = JSON.parse(filtersParam);
    return Array.isArray(filters) && filters.some(
      (f: any) => f.field === 'isPrivate' && f.op === '==' && f.value === false,
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const collection = searchParams.get('collection');
  const id = searchParams.get('id');
  const filtersParam = searchParams.get('filters');
  const session = await getSession();
  const fromDjWorker = isDjWorkerRequest(request);

  await ensureDb();

  // By-ID reads: public rooms (isPrivate===false) are readable without auth
  if (collection && id) {
    if (!session && !fromDjWorker) {
      if (collection === 'rooms') {
        const data = db.get(collection, id);
        if (data && data.isPrivate === false) {
          return NextResponse.json({ exists: true, data, id });
        }
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (fromDjWorker && collection !== 'rooms') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const access = isAllowedCollection(collection);
    if (access === 'denied') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (access === 'admin' && (!session || !(await isAdmin(session.uid)))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const data = db.get(collection, id);
    return NextResponse.json({ exists: !!data, data, id });
  }

  // Filtered queries: allow unauthenticated for public rooms only
  if (collection && filtersParam) {
    if (!session && !isPublicRoomsRead(collection, filtersParam)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session) {
      const access = isAllowedCollection(collection);
      if (access === 'denied') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (access === 'admin' && !(await isAdmin(session.uid))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      const filters = JSON.parse(filtersParam);
      const docs = db.query(collection, filters);
      return NextResponse.json(docs);
    } catch {
      return NextResponse.json({ error: 'Invalid filters JSON' }, { status: 400 });
    }
  }

  // List and fallback require auth
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (collection) {
    const access = isAllowedCollection(collection);
    if (access === 'denied') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (access === 'admin' && !(await isAdmin(session.uid))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const docs = db.list(collection);
    return NextResponse.json(docs);
  }

  return NextResponse.json({ exists: false });
}

export async function POST(request: NextRequest) {
  const session = await getSession();

  await ensureDb();
  const body = await request.json();
  const { collection, id, data, merge } = body;

  if (!collection || !data) {
    return NextResponse.json({ error: 'Missing collection or data' }, { status: 400 });
  }

  if (collection === 'rooms' && !id) {
    return NextResponse.json({ error: 'Room id is required. Rooms are not auto-generated.' }, { status: 400 });
  }

  const access = isAllowedCollection(collection);
  if (access === 'denied') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (access === 'admin' && (!session || !(await isAdmin(session.uid)))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session && access !== 'allowed') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const safeData = sanitizeUserWrite(collection, data);
  if (id) {
    db.set(collection, id, safeData, { merge: !!merge });
    return NextResponse.json({ success: true, id });
  }

  // Auto-generate ID
  const newId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.set(collection, newId, safeData);
  return NextResponse.json({ success: true, id: newId });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  const fromDjWorker = isDjWorkerRequest(request);
  const allowUnauthedRoomWrite = !session && !fromDjWorker;

  await ensureDb();
  const { collection, id, data } = await request.json();
  if (!collection || !id || !data) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  if (fromDjWorker && collection !== 'rooms') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (allowUnauthedRoomWrite && collection !== 'rooms') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = isAllowedCollection(collection);
  if (access === 'denied') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (access === 'admin' && (!session || !(await isAdmin(session.uid)))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  db.update(collection, id, sanitizeUserWrite(collection, data));
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureDb();
  const { collection, id } = await request.json();
  if (!collection || !id) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const access = isAllowedCollection(collection);
  if (access === 'denied') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (access === 'admin' && !(await isAdmin(session.uid))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  db.delete(collection, id);
  return NextResponse.json({ success: true });
}
