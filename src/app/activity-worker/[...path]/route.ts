import { NextRequest, NextResponse } from 'next/server';
import { getDjWorkerUrl } from '@/lib/dj-worker-config';

export const runtime = 'nodejs';

type Params = {
  params: Promise<{
    path?: string[];
  }>;
};

export async function GET(request: NextRequest, context: Params) {
  const { path = [] } = await context.params;
  const requestUrl = new URL(request.url);
  const target = new URL(`/${path.map(encodeURIComponent).join('/')}`, getDjWorkerUrl());
  target.search = requestUrl.search;

  return NextResponse.redirect(target, 307);
}
