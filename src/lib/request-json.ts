export class JsonRequestError extends Error {
  status = 400;

  constructor(message = 'Invalid JSON payload') {
    super(message);
    this.name = 'JsonRequestError';
  }
}

export async function parseJsonRequest<T = Record<string, unknown>>(
  request: Request,
  fallback: T = {} as T,
): Promise<T> {
  const raw = await request.text();
  if (!raw.trim()) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new JsonRequestError();
  }
}
