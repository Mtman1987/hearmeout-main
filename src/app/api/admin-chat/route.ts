import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDbApiKey, getDshUrl, getHardcodedGuildId } from '@/lib/runtime-config';

const CHAT_PATH = `servers/${getHardcodedGuildId()}/config/adminChat`;

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    details === undefined ? { error: message } : { error: message, details },
    { status }
  );
}

export async function GET() {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  try {
    const res = await fetch(`${getDshUrl()}/api/db?path=${CHAT_PATH}`);
    if (!res.ok) return NextResponse.json({ messages: [] });

    const data = await res.json();
    return NextResponse.json({ messages: data.data?.messages || [] });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errorResponse('Unauthorized', 401);

  try {
    const { message } = await req.json();
    if (!message?.text) return errorResponse('Missing message', 400);

    // Fetch current messages
    const getRes = await fetch(`${getDshUrl()}/api/db?path=${CHAT_PATH}`);
    const existing = getRes.ok ? await getRes.json() : { data: { messages: [] } };
    const messages = [...(existing.data?.messages || []), message].slice(-50);

    // Write back via DSH with API key
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const dbApiKey = getDbApiKey();
    if (dbApiKey) headers['x-api-key'] = dbApiKey;

    const writeRes = await fetch(`${getDshUrl()}/api/db`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: CHAT_PATH, data: { messages }, merge: true }),
    });

    if (!writeRes.ok) {
      const err = await writeRes.text();
      console.error('[AdminChat] Write failed:', err);
      return errorResponse('Failed to save message', 500, err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[AdminChat] Error:', error);
    return errorResponse('Internal error', 500);
  }
}