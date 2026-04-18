import { useState, useEffect } from 'react';
import { listDocs, getDoc } from '../../../local-db';

export function useCollection<T = any>(collection: string | null) {
  const [data, setData] = useState<T[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!collection) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const docIds = listDocs(collection);
      const docs = docIds.map(id => ({ ...getDoc(collection, id), id }));
      setData(docs);
    } catch (e) {
      setError(e as Error);
      setData(null);
    }
    setIsLoading(false);
  }, [collection]);

  return { data, isLoading, error };
}
