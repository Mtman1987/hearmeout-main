'use client';

import * as React from 'react';
import type { WorkspaceOverlayWidgetV1, WorkspaceThemeTokensV1 } from '@spmt/sdk';

const SPMT_ORIGIN = 'https://spmt.live';
const APP_ID = 'hearmeout';
type Surface = 'worktray' | 'settings' | 'overlays';

const SURFACE_URLS: Record<Surface, string> = {
  worktray: `${SPMT_ORIGIN}/embed/worktray?mode=dock&app=${APP_ID}`,
  settings: `${SPMT_ORIGIN}/embed/settings?mode=full&app=${APP_ID}`,
  overlays: `${SPMT_ORIGIN}/embed/overlays?mode=full&app=${APP_ID}`,
};

export function SpmtWorkspaceHost() {
  const [embedded, setEmbedded] = React.useState(true);
  const [connected, setConnected] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [surface, setSurface] = React.useState<Surface>('worktray');
  const [tokens, setTokens] = React.useState<WorkspaceThemeTokensV1 | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch('/api/spmt/workspace-theme', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) {
        setConnected(false);
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!body?.tokens) return;
      setTokens(body.tokens as WorkspaceThemeTokensV1);
      setConnected(true);
      window.dispatchEvent(new CustomEvent('spmt-workspace-refresh', { detail: body }));
    } catch {
      setConnected(false);
    }
  }, []);

  React.useEffect(() => {
    setEmbedded(window.self !== window.top);
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== SPMT_ORIGIN || event.data?.type !== 'spmt.surface.updated') return;
      void refresh();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refresh]);

  if (embedded || !connected) return null;

  const overlay = tokens?.overlayWorkspace;
  const widgets = overlay?.enabled ? (overlay.widgets || []).filter((widget) => widget.visible) : [];

  return (
    <>
      <div aria-hidden={!overlay?.enabled} className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
        {widgets.map((widget: WorkspaceOverlayWidgetV1) => (
          <iframe
            key={widget.id}
            src={widget.url}
            title={widget.title || widget.id}
            className={widget.interactive ? 'pointer-events-auto absolute border-0 bg-transparent' : 'pointer-events-none absolute border-0 bg-transparent'}
            style={{
              left: widget.x,
              top: widget.y,
              width: widget.width,
              height: widget.height,
              opacity: Math.max(0, Math.min(1, Number(widget.opacity ?? 1))),
            }}
            allow="autoplay; microphone; camera; fullscreen; clipboard-write"
          />
        ))}
      </div>

      {open && (
        <section className="fixed inset-x-3 bottom-16 z-[100] mx-auto flex h-[min(78vh,760px)] max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/85 shadow-2xl backdrop-blur-xl sm:inset-x-6">
          <header className="flex items-center gap-2 border-b border-white/10 p-2">
            {(['worktray', 'settings', 'overlays'] as Surface[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSurface(item)}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${surface === item ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}
              >
                {item === 'worktray' ? 'Workspace' : item === 'settings' ? 'Settings' : 'Overlay Bay'}
              </button>
            ))}
            <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white">Close</button>
          </header>
          <iframe
            key={surface}
            src={SURFACE_URLS[surface]}
            title={`SPMT ${surface}`}
            className="min-h-0 flex-1 border-0 bg-transparent"
            allow="autoplay; microphone; camera; fullscreen; clipboard-write"
          />
        </section>
      )}

      <button
        type="button"
        onClick={() => { setSurface('worktray'); setOpen((value) => !value); }}
        className="fixed bottom-3 right-3 z-[110] rounded-full border border-white/15 bg-black/75 px-4 py-2.5 text-sm font-semibold text-white shadow-xl backdrop-blur-xl transition hover:bg-black/90 sm:right-5"
        aria-expanded={open}
      >
        Workspace
      </button>
    </>
  );
}
