import { NextRequest, NextResponse } from 'next/server';
import { HMO_SPMT_COOKIE, SPMT_BASE_URL } from '@/lib/spmt-session';

async function forward(request: NextRequest, namespace: string, method: 'GET' | 'PUT') {
  const token = request.cookies.get(HMO_SPMT_COOKIE)?.value || '';
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(namespace)) return NextResponse.json({ error: 'Invalid namespace' }, { status: 400 });
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const ifMatch = request.headers.get('if-match');
  if (ifMatch) headers['If-Match'] = ifMatch;
  const body = method === 'PUT' ? JSON.stringify(await request.json().catch(() => ({}))) : undefined;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${SPMT_BASE_URL}/api/app-state/hearmeout/${namespace}`, { method, headers, body, cache: 'no-store' });
  const payload = await response.json().catch(() => ({ error: 'Invalid SPMT response' }));
  const next = NextResponse.json(payload, { status: response.status });
  if (response.headers.get('etag')) next.headers.set('etag', response.headers.get('etag')!);
  return next;
}

export async function GET(request: NextRequest, context: { params: Promise<{ namespace: string }> }) { return forward(request, (await context.params).namespace, 'GET'); }
export async function PUT(request: NextRequest, context: { params: Promise<{ namespace: string }> }) { return forward(request, (await context.params).namespace, 'PUT'); }
