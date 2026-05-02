// DJ Service — forwards to the hmo-dj-worker

import { getDjWorkerSecret, getDjWorkerUrl } from './dj-worker-config';

const DJ_WORKER_URL = getDjWorkerUrl();
const DJ_WORKER_SECRET = getDjWorkerSecret();

async function workerFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${DJ_WORKER_URL}${path}`, {
    ...options,
    headers: {
      ...((options.headers as Record<string, string>) || {}),
      Authorization: `Bearer ${DJ_WORKER_SECRET}`,
    },
  });
}

export async function startDJ(roomId: string): Promise<{ success: boolean; message: string }> {
  if (!DJ_WORKER_URL) return { success: false, message: 'DJ_WORKER_URL not configured' };
  try {
    const res = await workerFetch('/dj', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', roomId }),
    });
    return await res.json();
  } catch (err: any) {
    console.error('[DJ] Worker request failed:', err.message);
    return { success: false, message: `Worker error: ${err.message}` };
  }
}

export async function stopDJ(roomId: string): Promise<{ success: boolean; message: string }> {
  if (!DJ_WORKER_URL) return { success: false, message: 'DJ_WORKER_URL not configured' };
  try {
    const res = await workerFetch('/dj', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop', roomId }),
    });
    return await res.json();
  } catch (err: any) {
    console.error('[DJ] Worker stop failed:', err.message);
    return { success: false, message: `Worker error: ${err.message}` };
  }
}

export async function isDJRunning(roomId: string): Promise<boolean> {
  if (!DJ_WORKER_URL) return false;
  try {
    const res = await workerFetch(`/dj?roomId=${encodeURIComponent(roomId)}`);
    const data = await res.json();
    return !!data.running;
  } catch {
    return false;
  }
}

export async function getActiveInstances(): Promise<Array<{ roomId: string; startedAt: Date }>> {
  if (!DJ_WORKER_URL) return [];
  try {
    const res = await workerFetch('/dj');
    const data = await res.json();
    return (data.instances || []).map((i: any) => ({
      roomId: i.roomId,
      startedAt: new Date(i.startedAt),
    }));
  } catch {
    return [];
  }
}
