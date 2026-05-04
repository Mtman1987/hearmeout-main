// Client-side DB write helpers — fire-and-forget like the old non-blocking updates

export function dbSet(collection: string, id: string, data: any, merge = false) {
  fetch('/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection, id, data, merge }),
  }).catch(console.error);
}

export async function dbUpdateStrict(collection: string, id: string, data: any) {
  const res = await fetch('/api/db', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection, id, data }),
  });
  const result = await res.json().catch(() => null);
  if (!res.ok || result?.error) {
    throw new Error(result?.error || `DB update failed (${res.status})`);
  }
  return result;
}

export function dbUpdate(collection: string, id: string, data: any) {
  dbUpdateStrict(collection, id, data).catch(console.error);
}

export function dbDelete(collection: string, id: string) {
  fetch('/api/db', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection, id }),
  }).catch(console.error);
}

export async function dbAdd(collection: string, data: any): Promise<string> {
  const res = await fetch('/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection, data }),
  });
  const result = await res.json();
  return result.id;
}

export async function dbGet(collection: string, id: string): Promise<any> {
  const res = await fetch(`/api/db?collection=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}`);
  const result = await res.json();
  return result.exists ? result.data : null;
}
