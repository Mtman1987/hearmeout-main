import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

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

  await ensureDb();

  // By-ID reads: public rooms (isPrivate===false) are readable without auth
  if (collection && id) {
    if (!session) {
      if (collection === 'rooms') {
        const data = db.get(collection, id);
        if (data && data.isPrivate === false) {
          return NextResponse.json({ exists: true, data, id });
        }
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const data = db.get(collection, id);
    return NextResponse.json({ exists: !!data, data, id });
  }

  // Filtered queries: allow unauthenticated for public rooms only
  if (collection && filtersParam) {
    if (!session && !isPublicRoomsRead(collection, filtersParam)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    const docs = db.list(collection);
    return NextResponse.json(docs);
  }

  return NextResponse.json({ exists: false });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureDb();
  const body = await request.json();
  const { collection, id, data, merge } = body;

  if (!collection || !data) {
    return NextResponse.json({ error: 'Missing collection or data' }, { status: 400 });
  }

  if (id) {
    db.set(collection, id, data, { merge: !!merge });
    return NextResponse.json({ success: true, id });
  }

  // Auto-generate ID
  const newId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.set(collection, newId, data);
  return NextResponse.json({ success: true, id: newId });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureDb();
  const { collection, id, data } = await request.json();
  if (!collection || !id || !data) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  db.update(collection, id, data);
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
  db.delete(collection, id);
  return NextResponse.json({ success: true });
}
