import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const runtime = 'nodejs';
export async function GET() {
  const script = await readFile(join(process.cwd(), 'node_modules/hls.js/dist/hls.min.js'));
  return new Response(script, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
}
