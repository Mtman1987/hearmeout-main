import { NextResponse } from 'next/server';
import { getXtreamCatalogDiagnostics, getXtreamStatus } from '@/lib/xtream-provider';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = await getXtreamStatus();
    if (url.searchParams.get('diagnostics') !== '1') return NextResponse.json(status);
    const diagnostics = await getXtreamCatalogDiagnostics(url.searchParams.get('q'));
    return NextResponse.json({ ...status, diagnostics });
  } catch (error: any) {
    return NextResponse.json({ configured: true, error: error.message || 'Xtream status failed' }, { status: 502 });
  }
}
