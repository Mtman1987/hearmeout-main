import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { DSH_URL, HARDCODED_GUILD_ID } from '@/lib/constants';

const DB_API_KEY = process.env.DB_API_KEY || '';

function getChatPath(serverId?: string | null) {
  const resolved = serverId || process.env.HARDCODED_GUILD_ID || HARDCODED_GUILD_ID;
  if (!resolved) return null;
  return `servers/${resolved}/config/adminChat`;
}

export async function GET(req: NextRequest) {
  const chatPath = getChatPath(new URL(req.url).searchParams.get('serverId'));
  if (!chatPath) return NextResponse.json({ messages: [] });
  try {
    const res = await fetch(`${DSH_URL}/api/db?path=${chatPath}`);
    if (!res.ok) return NextResponse.json({ messages: [] });
    const data = await res.json();
    return NextResponse.json({ messages: data.data?.messages || [] });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const chatPath = getChatPath(new URL(req.url).searchParams.get('serverId'));
  if (!chatPath) return NextResponse.json({ error: 'Missing serverId' }, { status: 400 });

  try {
    const { message } = await req.json();
    if (!message?.text) return NextResponse.json({ error: 'Missing message' }, { status: 400 });

    // Fetch current messages
    const getRes = await fetch(`${DSH_URL}/api/db?path=${chatPath}`);
    const existing = getRes.ok ? await getRes.json() : { data: { messages: [] } };
    const messages = [...(existing.data?.messages || []), message].slice(-50);

    // Write back via DSH with API key
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (DB_API_KEY) headers['x-api-key'] = DB_API_KEY;

    const writeRes = await fetch(`${DSH_URL}/api/db`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: chatPath, data: { messages }, merge: true }),
    });

    if (!writeRes.ok) {
      const err = await writeRes.text();
      console.error('[AdminChat] Write failed:', err);
      return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[AdminChat] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
