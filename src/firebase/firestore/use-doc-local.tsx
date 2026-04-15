import { useState, useEffect } from 'react';
import { getDoc } from '../../../local-db';

export function useDoc<T = any>(collection: string | null, docId: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!collection || !docId) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const doc = getDoc(collection, docId);
      setData(doc);
    } catch (e) {
      setError(e as Error);
      setData(null);
    }
    setIsLoading(false);
  }, [collection, docId]);

  return { data, isLoading, error };
}
