'use client';

import { useState } from 'react';

export type WithId<T> = T & { id: string };

export interface UseCollectionResult<T> {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Deprecated — Firebase removed. This is a no-op stub.
 * The app uses use-collection-local.tsx and the /api/db polling approach instead.
 */
export function useCollection<T = any>(
  _memoizedTargetRefOrQuery: any,
): UseCollectionResult<T> {
  const [data] = useState<WithId<T>[] | null>(null);
  return { data, isLoading: false, error: null };
}
