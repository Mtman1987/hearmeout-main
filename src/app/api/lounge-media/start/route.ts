import { loungeAction } from '@/lib/lounge-worker';

export const runtime = 'nodejs';

export async function POST() {
  return loungeAction('start');
}
