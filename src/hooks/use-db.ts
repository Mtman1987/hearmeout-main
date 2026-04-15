'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type WithId<T> = T & { id: string };

interface UseDocResult<T> {
  data: WithId<T> | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

interface UseCollectionResult<T> {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

// Poll a single document
export function useDoc<T = any>(
  collection: string | null,
  id: string | null,
  pollInterval = 5000,
): UseDocResult<T> {
  const [data, setData] = useState<WithId<T> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const fetchDoc = useCallback(async () => {
    if (!collection || !id) {
      setData(null);
      setIsLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/db?collection=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const result = await res.json();
      if (mountedRef.current) {
        setData(result.exists ? { ...result.data, id: result.id } : null);
        setError(null);
        setIsLoading(false);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e as Error);
        setIsLoading(false);
      }
    }
  }, [collection, id]);

  useEffect(() => {
    mountedRef.current = true;
    if (!collection || !id) {
      setData(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchDoc();
    const interval = setInterval(fetchDoc, pollInterval);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [collection, id, pollInterval, fetchDoc]);

  return { data, isLoading, error, refresh: fetchDoc };
}

// Poll a collection with optional filters
export function useCollection<T = any>(
  collection: string | null,
  options?: {
    filters?: Array<{ field: string; op: string; value: any }>;
    orderBy?: string;
    orderDir?: 'asc' | 'desc';
    limit?: number;
    pollInterval?: number;
  },
): UseCollectionResult<T> {
  const [data, setData] = useState<WithId<T>[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const pollInterval = options?.pollInterval ?? 5000;

  // Stable serialization of options for dependency tracking
  const optionsKey = JSON.stringify({
    filters: options?.filters,
    orderBy: options?.orderBy,
    orderDir: options?.orderDir,
    limit: options?.limit,
  });

  const fetchCollection = useCallback(async () => {
    if (!collection) {
      setData(null);
      setIsLoading(false);
      return;
    }
    try {
      const params = new URLSearchParams({ collection });
      const opts = JSON.parse(optionsKey);
      if (opts.filters) params.set('filters', JSON.stringify(opts.filters));
      if (opts.orderBy) params.set('orderBy', opts.orderBy);
      if (opts.orderDir) params.set('orderDir', opts.orderDir);
      if (opts.limit) params.set('limit', String(opts.limit));

      const res = await fetch(`/api/db?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const result = await res.json();
      if (mountedRef.current) {
        const docs = result.map((d: any) => ({ ...d.data, id: d.id }));
        setData(docs);
        setError(null);
        setIsLoading(false);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e as Error);
        setIsLoading(false);
      }
    }
  }, [collection, optionsKey]);

  useEffect(() => {
    mountedRef.current = true;
    if (!collection) {
      setData(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchCollection();
    const interval = setInterval(fetchCollection, pollInterval);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [collection, pollInterval, fetchCollection]);

  return { data, isLoading, error, refresh: fetchCollection };
}
