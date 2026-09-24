import { getLoungeSourceState } from '@/lib/lounge-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json(await getLoungeSourceState(), { headers: { 'cache-control': 'no-store' } });
}
