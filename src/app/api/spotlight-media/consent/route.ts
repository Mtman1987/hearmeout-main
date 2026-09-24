import { spotlightAction } from '@/lib/spotlight-worker';

export const runtime = 'nodejs';
export async function POST(request: Request) { return spotlightAction(request, 'consent'); }
