// DJ Service — thin wrapper for any server-side code that needs to talk to the worker
import { getDjWorkerSecret, getDjWorkerUrl } from './dj-worker-config';

export async function startDJ(roomId: string): Promise<{ success: boolean; message: string }> {
  return workerAction({ action: 'start', roomId });
}

export async function stopDJ(roomId: string): Promise<{ success: boolean; message: string }> {
  return workerAction({ action: 'stop', roomId });
}

export async function isDJRunning(roomId: string): Promise<boolean> {
  const url = getDjWorkerUrl();
  const secret = getDjWorkerSecret();
  if (!url || !secret) return false;
  try {
    const res = await fetch(`${url}/dj?roomId=${encodeURIComponent(roomId)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const data = await res.json();
    return !!data.running;
  } catch {
    return false;
  }
}

export async function getActiveInstances(): Promise<Array<{ roomId: string; startedAt: Date }>> {
  const url = getDjWorkerUrl();
  const secret = getDjWorkerSecret();
  if (!url || !secret) return [];
  try {
    const res = await fetch(`${url}/dj`, { headers: { Authorization: `Bearer ${secret}` } });
    const data = await res.json();
    return (data.instances || []).map((i: any) => ({ roomId: i.roomId, startedAt: new Date(i.startedAt) }));
  } catch {
    return [];
  }
}

async function workerAction(body: Record<string, unknown>): Promise<{ success: boolean; message: string }> {
  const url = getDjWorkerUrl();
  const secret = getDjWorkerSecret();
  if (!url || !secret) return { success: false, message: 'DJ worker not configured' };
  try {
    const res = await fetch(`${url}/dj`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json().catch(() => ({ success: false, message: `Worker returned ${res.status}` }));
  } catch (err: any) {
    return { success: false, message: `Worker unreachable: ${err.message}` };
  }
}
