'use client';

import { useState } from 'react';

type WithId<T> = T & { id: string };

export interface UseDocResult<T> {
  data: WithId<T> | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Deprecated — Firebase removed. This is a no-op stub.
 * The app uses use-doc-local.tsx and the /api/db polling approach instead.
 */
export function useDoc<T = any>(
  _memoizedDocRef: any,
): UseDocResult<T> {
  const [data] = useState<WithId<T> | null>(null);
  return { data, isLoading: false, error: null };
}
