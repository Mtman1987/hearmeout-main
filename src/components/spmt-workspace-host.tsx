'use client';

import * as React from 'react';
import { ExternalLink, LayoutGrid, PanelsTopLeft, RefreshCw, Settings, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { WorkspaceDockSlotV1, WorkspaceThemeTokensV1 } from '@spmt/sdk';

const SPMT_ORIGIN = 'https://spmt.live';
const SPACEMOUNTAIN_ORIGIN = 'https://spacemountain.live';
const MANAGEMENT_LINKS = [
  { label: 'Workspace', href: `${SPACEMOUNTAIN_ORIGIN}/?surface=workspace`, Icon: LayoutGrid },
  { label: 'Overlay', href: `${SPACEMOUNTAIN_ORIGIN}/?surface=overlay`, Icon: PanelsTopLeft },
  { label: 'Settings', href: `${SPACEMOUNTAIN_ORIGIN}/settings`, Icon: Settings },
] as const;

function usableSlots(tokens: WorkspaceThemeTokensV1 | null) {
  return (tokens?.dockSlots || []).filter((slot) => Boolean(slot.url?.trim()));
}

function fallbackSlots(): WorkspaceDockSlotV1[] {
  return ([1, 2, 3] as const).map((id) => ({
    id,
    title: `Slot ${id}`,
    url: '',
    collapsed: true,
    volume: 1,
    muted: false,
  }));
}

export function SpmtWorkspaceHost() {
  const pathname = usePathname();
  const hiddenRoute = /^\/(api|auth|login|embed|headless|activity)(\/|$)/.test(pathname) || pathname.startsWith('/overlay/');
  const [embedded, setEmbedded] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [tokens, setTokens] = React.useState<WorkspaceThemeTokensV1 | null>(null);
  const [activeSlotId, setActiveSlotId] = React.useState<number | null>(null);

  const reconnectHref = `/login?next=${encodeURIComponent(pathname || '/')}`;

  const refresh = React.useCallback(async () => {
    if (hiddenRoute) return;
    try {
      const response = await fetch('/api/spmt/workspace-theme', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) {
        setConnected(false);
        setTokens(null);
        setLoaded(true);
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!body?.tokens) {
        setConnected(false);
        setTokens(null);
        setLoaded(true);
        return;
      }
      const nextTokens = body.tokens as WorkspaceThemeTokensV1;
      const slots = usableSlots(nextTokens);
      setTokens(nextTokens);
      setActiveSlotId((current) => {
        if (nextTokens.dockSlots?.some((slot) => slot.id === current)) return current;
        return slots[0]?.id ?? nextTokens.dockSlots?.[0]?.id ?? null;
      });
      setConnected(true);
      setLoaded(true);
    } catch {
      setConnected(false);
      setTokens(null);
      setLoaded(true);
    }
  }, [hiddenRoute]);

  React.useEffect(() => {
    const isEmbedded = window.self !== window.top;
    setEmbedded(isEmbedded);
    if (!isEmbedded) void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (hiddenRoute || embedded) return;
    const onFocus = () => void refresh();
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [embedded, hiddenRoute, refresh]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== SPMT_ORIGIN || event.data?.type !== 'spmt.surface.updated') return;
      void refresh();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refresh]);

  if (hiddenRoute || embedded) return null;

  const traySlots = tokens?.dockSlots?.length ? tokens.dockSlots : fallbackSlots();
  const activeSlot = traySlots.find((slot) => slot.id === activeSlotId) || traySlots[0] || null;
  const overlay = connected ? tokens?.overlayWorkspace : null;
  const widgets = overlay?.enabled ? (overlay.widgets || []).filter((widget) => widget.visible && widget.url) : [];

  const openSlot = (slot: WorkspaceDockSlotV1) => {
    if (!connected) {
      setOpen(true);
      return;
    }
    setActiveSlotId(slot.id);
    setOpen(true);
  };

  return <>
    {connected && <div aria-hidden={!overlay?.enabled} className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      {widgets.map((widget) => {
        const rawOpacity = Number(widget.opacity ?? 1);
        const opacity = rawOpacity > 1 ? rawOpacity / 100 : rawOpacity;
        return <iframe
          key={widget.id}
          src={widget.url}
          title={widget.title || widget.id}
          className={widget.interactive ? 'pointer-events-auto absolute border-0 bg-transparent' : 'pointer-events-none absolute border-0 bg-transparent'}
          style={{
            left: `${Number(widget.x || 0)}%`,
            top: `${Number(widget.y || 0)}%`,
            width: Number(widget.width || 320),
            height: Number(widget.height || 180),
            opacity: Math.max(0, Math.min(1, opacity)),
          }}
          allow="autoplay; microphone; camera; fullscreen; clipboard-write"
        />;
      })}
    </div>}

    {open && <section className="fixed inset-x-3 bottom-[76px] z-[100] mx-auto flex h-[min(72vh,700px)] max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/90 shadow-2xl backdrop-blur-xl sm:inset-x-6">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 p-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {connected ? traySlots.map((slot) => (
            <button key={slot.id} type="button" onClick={() => setActiveSlotId(slot.id)} className={`rounded-lg px-3 py-2 text-sm font-medium ${activeSlot?.id === slot.id ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}>
              {slot.title || `Slot ${slot.id}`}
            </button>
          )) : <span className="px-2 text-xs font-semibold text-amber-200">SPMT workspace disconnected</span>}
        </div>
        <div className="flex items-center gap-1 border-l border-white/10 pl-2">
          {MANAGEMENT_LINKS.map(({ label, href, Icon }) => <a key={label} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-white/65 hover:bg-white/10 hover:text-white" title={`Manage ${label} in SpaceMountainLive`}><Icon className="h-4 w-4" aria-hidden /><span className="hidden md:inline">{label}</span><ExternalLink className="h-3 w-3 opacity-60" aria-hidden /></a>)}
          <button type="button" onClick={() => setOpen(false)} className="inline-flex items-center rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close workspace"><X className="h-4 w-4" aria-hidden /></button>
        </div>
      </header>

      {!loaded ? <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-white/70"><RefreshCw className="h-7 w-7 animate-spin" aria-hidden /><p className="text-sm">Connecting to your SPMT workspace…</p></div>
        : !connected ? <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-white/75"><LayoutGrid className="h-9 w-9 text-amber-300" aria-hidden /><div><p className="font-semibold text-white">HearMeOut is open, but the shared SPMT workspace is not connected.</p><p className="mt-1 max-w-lg text-sm text-white/55">Reconnect SPMT to restore your Worktray, shared appearance, workspace URLs, and saved overlays.</p></div><a href={reconnectHref} className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-200">Reconnect SPMT workspace</a></div>
          : activeSlot?.url?.trim() ? <iframe key={`${activeSlot.id}:${activeSlot.url}`} src={activeSlot.url} title={activeSlot.title || `Workspace slot ${activeSlot.id}`} className="min-h-0 flex-1 border-0 bg-transparent" allow="autoplay; microphone; camera; fullscreen; clipboard-write" />
            : <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-white/70"><LayoutGrid className="h-8 w-8" aria-hidden /><p className="text-sm">This workspace slot has no URL assigned yet.</p><a href={MANAGEMENT_LINKS[0].href} target="_blank" rel="noreferrer" className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">Manage Workspace in SpaceMountainLive</a></div>}
    </section>}

    <aside className="fixed inset-x-3 bottom-3 z-[110] mx-auto max-w-5xl overflow-hidden rounded-2xl border border-white/15 bg-black/80 shadow-[0_-14px_42px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:inset-x-6" aria-label="SPMT workspace tray">
      <div className="flex min-h-14 items-center gap-2 p-2">
        <button type="button" onClick={() => setOpen((value) => !value)} className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold text-white ${open ? 'border-cyan-300/40 bg-cyan-300/10' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'}`} aria-expanded={open}>
          <LayoutGrid className="h-4 w-4 text-cyan-300" aria-hidden />
          <span className="hidden sm:inline">Workspace</span>
          {!loaded ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" title="Checking SPMT" /> : connected ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="SPMT connected" /> : <span className="h-1.5 w-1.5 rounded-full bg-amber-300" title="SPMT reconnect required" />}
        </button>
        <div className="grid min-w-0 flex-1 grid-cols-3 gap-1.5">
          {traySlots.map((slot) => (
            <button key={slot.id} type="button" onClick={() => openSlot(slot)} className={`min-w-0 rounded-xl border px-2.5 py-2 text-left ${connected && activeSlot?.id === slot.id && open ? 'border-cyan-300/35 bg-cyan-300/[0.08]' : 'border-white/10 bg-white/[0.025] hover:bg-white/[0.06]'}`}>
              <span className="block truncate text-[10px] font-bold text-white">{connected ? (slot.title || `Slot ${slot.id}`) : `Slot ${slot.id}`}</span>
              <span className="mt-0.5 block text-[8px] font-semibold uppercase tracking-wide text-white/35">{connected ? (slot.collapsed ? 'Hidden' : `Slot ${slot.id}`) : 'SPMT offline'}</span>
            </button>
          ))}
        </div>
        {!connected && loaded ? <a href={reconnectHref} className="hidden shrink-0 items-center gap-1.5 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[10px] font-bold text-amber-100 hover:bg-amber-300/15 md:inline-flex"><RefreshCw className="h-3.5 w-3.5" aria-hidden />Reconnect</a> : null}
      </div>
    </aside>
  </>;
}
