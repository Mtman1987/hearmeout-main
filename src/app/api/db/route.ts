import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const collection = searchParams.get('collection');
  const id = searchParams.get('id');
  const filtersParam = searchParams.get('filters');

  await ensureDb();

  if (collection && id) {
    const data = db.get(collection, id);
    return NextResponse.json({ exists: !!data, data, id });
  }

  if (collection && filtersParam) {
    const filters = JSON.parse(filtersParam);
    const docs = db.query(collection, filters);
    return NextResponse.json(docs);
  }

  if (collection) {
    const docs = db.list(collection);
    return NextResponse.json(docs);
  }

  return NextResponse.json({ exists: false });
}

export async function POST(request: NextRequest) {
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
  await ensureDb();
  const { collection, id, data } = await request.json();
  if (!collection || !id || !data) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  db.update(collection, id, data);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  await ensureDb();
  const { collection, id } = await request.json();
  if (!collection || !id) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  db.delete(collection, id);
  return NextResponse.json({ success: true });
}
