import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

// Collections that allow unauthenticated reads (with restrictions)
const PUBLIC_READ_COLLECTIONS = new Set(['rooms']);

// Filter out private documents for unauthenticated reads
function filterPublic(docs: any[]): any[] {
  return docs.filter(d => !d.data?.isPrivate && !d.isPrivate);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const collection = searchParams.get('collection');
  const id = searchParams.get('id');
  const filtersParam = searchParams.get('filters');

  const session = await getSession();
  const isPublicCollection = collection && PUBLIC_READ_COLLECTIONS.has(collection);

  // Require auth for non-public collections
  if (!isPublicCollection && !session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureDb();

  if (collection && id) {
    const data = db.get(collection, id);
    // Block unauthenticated access to private rooms
    if (!session && isPublicCollection && data?.isPrivate) {
      return NextResponse.json({ exists: false });
    }
    return NextResponse.json({ exists: !!data, data, id });
  }

  if (collection && filtersParam) {
    let filters;
    try {
      filters = JSON.parse(filtersParam);
    } catch {
      return NextResponse.json({ error: 'Invalid filters JSON' }, { status: 400 });
    }
    let docs = db.query(collection, filters);
    if (!session && isPublicCollection) docs = filterPublic(docs);
    return NextResponse.json(docs);
  }

  if (collection) {
    let docs = db.list(collection);
    if (!session && isPublicCollection) docs = filterPublic(docs);
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
