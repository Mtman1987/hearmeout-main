'use client';

import * as React from 'react';
import type { WorkspaceThemeTokensV1 } from '@spmt/sdk';
import { applyWorkspaceThemeTokens } from '@/lib/workspace-theme';

const WORKSPACE_REFRESH_MS = 30_000;

export function WorkspaceTruthProvider({ children }: { children: React.ReactNode }) {
  const revisionRef = React.useRef<number | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch('/api/spmt/workspace-theme', {
        cache: 'no-store',
        credentials: 'include',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.tokens) return;
      const revision = Number(body.revision || 0);
      if (revisionRef.current === revision && document.documentElement.dataset.workspaceTheme) return;
      applyWorkspaceThemeTokens(document.documentElement, body.tokens as WorkspaceThemeTokensV1);
      revisionRef.current = revision;
      window.dispatchEvent(new CustomEvent('spmt-workspace-updated', { detail: body }));
    } catch {
      // Preserve the most recently applied canonical workspace during transient failures.
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), WORKSPACE_REFRESH_MS);
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  return <>{children}</>;
}
