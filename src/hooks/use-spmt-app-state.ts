'use client';

import * as React from 'react';

export function useSpmtAppState<T extends object>(namespace: string, defaults: T) {
  const [value, setValue] = React.useState<T>(defaults);
  const revision = React.useRef<number | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [accountBacked, setAccountBacked] = React.useState(false);
  const defaultsRef = React.useRef(defaults);
  const legacyKey = `hearmeout-app-state:${namespace}`;

  const readLegacy = React.useCallback(() => {
    try { return { ...defaultsRef.current, ...JSON.parse(window.localStorage.getItem(legacyKey) || '{}') } as T; }
    catch { return defaultsRef.current; }
  }, [legacyKey]);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/spmt/app-state/${namespace}`, { cache: 'no-store', credentials: 'include' })
      .then(async (response) => ({ status: response.status, data: await response.json().catch(() => null) }))
      .then(({ status, data }) => {
        if (cancelled) return;
        if (status === 200) {
          revision.current = data.revision;
          setValue({ ...defaultsRef.current, ...(data.data || {}) });
          setAccountBacked(true);
        } else if (status === 404) {
          setValue(readLegacy());
          setAccountBacked(true);
        } else if (status === 401) {
          setValue(readLegacy());
          setAccountBacked(false);
        }
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [namespace, readLegacy]);

  const save = React.useCallback(async (next: T) => {
    if (!accountBacked) {
      window.localStorage.setItem(legacyKey, JSON.stringify(next));
      setValue(next);
      return next;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (revision.current != null) headers['If-Match'] = `"app-state-hearmeout-${namespace}-${revision.current}"`;
    const response = await fetch(`/api/spmt/app-state/${namespace}`, {
      method: 'PUT', credentials: 'include', headers,
      body: JSON.stringify({ schemaVersion: 1, revision: revision.current, data: next }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Setting save failed');
    revision.current = data.revision;
    setValue(data.data);
    window.localStorage.removeItem(legacyKey);
    return data.data as T;
  }, [namespace, accountBacked, legacyKey]);

  return { value, setValue, save, loaded, accountBacked };
}
