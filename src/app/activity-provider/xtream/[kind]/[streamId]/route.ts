import { NextResponse } from 'next/server';
// Older players must reopen the common player. Never create another upstream
// connection or converter for a browser, room, or requested provider item.
export async function GET(_request: Request, _context?: unknown) {
  return NextResponse.json({ error: 'Reopen the shared player.', playerUrl: '/activity' }, { status: 410 });
}
