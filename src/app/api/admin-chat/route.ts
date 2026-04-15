import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

const DSH_URL = 'https://discord-stream-hub-new.fly.dev';
const DB_API_KEY = process.env.DB_API_KEY || '';
const SERVER_ID = process.env.HARDCODED_GUILD_ID || '1240832965865635881';
const CHAT_PATH = `servers/${SERVER_ID}/config/adminChat`;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const res = await fetch(`${DSH_URL}/api/db?path=${CHAT_PATH}`);
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

  try {
    const { message } = await req.json();
    if (!message?.text) return NextResponse.json({ error: 'Missing message' }, { status: 400 });

    // Fetch current messages
    const getRes = await fetch(`${DSH_URL}/api/db?path=${CHAT_PATH}`);
    const existing = getRes.ok ? await getRes.json() : { data: { messages: [] } };
    const messages = [...(existing.data?.messages || []), message].slice(-50);

    // Write back via DSH with API key
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (DB_API_KEY) headers['x-api-key'] = DB_API_KEY;

    const writeRes = await fetch(`${DSH_URL}/api/db`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: CHAT_PATH, data: { messages }, merge: true }),
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
