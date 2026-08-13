'use client';

import * as React from 'react';
import { LayoutGrid, PanelsTopLeft, RefreshCw, Settings, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { WorkspaceDockSlotV1, WorkspaceThemeTokensV1 } from '@spmt/sdk';

const SPMT_ORIGIN = 'https://spmt.live';
const PERSONAL_VISIBILITY_KEY = 'hearmeout:personal-overlay-visible';
const FOOTER_VISIBILITY_KEY = 'hearmeout:workspace-footer-visible';
const PERSONAL_VISIBILITY_EVENT = 'spmt:personal-overlay-visibility';

type TenantOutputs = { public?: string; personal?: string };
type SurfaceUrls = { worktray?: string; overlays?: string; settings?: string };
type SurfaceId = keyof SurfaceUrls;
type PanelTarget = { kind: 'slot'; id: number } | { kind: 'surface'; id: SurfaceId };

const SURFACE_CONTROLS = [
  { id: 'worktray' as const, label: 'Workspace', Icon: LayoutGrid },
  { id: 'overlays' as const, label: 'Overlay Bay', Icon: PanelsTopLeft },
  { id: 'settings' as const, label: 'Settings', Icon: Settings },
];

function fallbackSlots(): WorkspaceDockSlotV1[] {
  return ([1, 2, 3] as const).map((id) => ({ id, title: `Slot ${id}`, url: '', collapsed: true, volume: 1, muted: false }));
}

export function SpmtWorkspaceHost() {
  const pathname = usePathname();
  const hiddenRoute = /^\/(api|auth|login|embed|headless|activity)(\/|$)/.test(pathname) || pathname.startsWith('/overlay/');
  const [embedded, setEmbedded] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [tokens, setTokens] = React.useState<WorkspaceThemeTokensV1 | null>(null);
  const [target, setTarget] = React.useState<PanelTarget>({ kind: 'surface', id: 'worktray' });
  const [tenantOutputs, setTenantOutputs] = React.useState<TenantOutputs | null>(null);
  const [surfaceUrls, setSurfaceUrls] = React.useState<SurfaceUrls>({});
  const [personalOverlayVisible, setPersonalOverlayVisible] = React.useState(true);
  const [footerVisible, setFooterVisible] = React.useState(true);

  const reconnectHref = `/login?next=${encodeURIComponent(pathname || '/')}`;

  const refresh = React.useCallback(async () => {
    if (hiddenRoute) return;
    try {
      const response = await fetch('/api/spmt/workspace-theme', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) {
        setConnected(false); setTokens(null); setTenantOutputs(null); setSurfaceUrls({}); setLoaded(true); return;
      }
      const body = await response.json().catch(() => ({}));
      if (!body?.tokens) {
        setConnected(false); setTokens(null); setTenantOutputs(null); setSurfaceUrls({}); setLoaded(true); return;
      }
      setTokens(body.tokens as WorkspaceThemeTokensV1);
      setTenantOutputs(body?.tenantOutputs && typeof body.tenantOutputs === 'object' ? body.tenantOutputs as TenantOutputs : null);
      setSurfaceUrls(body?.surfaceUrls && typeof body.surfaceUrls === 'object' ? body.surfaceUrls as SurfaceUrls : {});
      setConnected(true); setLoaded(true);
    } catch {
      setConnected(false); setTokens(null); setTenantOutputs(null); setSurfaceUrls({}); setLoaded(true);
    }
  }, [hiddenRoute]);

  React.useEffect(() => {
    const isEmbedded = window.self !== window.top;
    setEmbedded(isEmbedded);
    setPersonalOverlayVisible(window.localStorage.getItem(PERSONAL_VISIBILITY_KEY) !== '0');
    setFooterVisible(window.localStorage.getItem(FOOTER_VISIBILITY_KEY) !== '0');
    if (!isEmbedded) void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (hiddenRoute || embedded) return;
    const onFocus = () => void refresh();
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility); };
  }, [embedded, hiddenRoute, refresh]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== SPMT_ORIGIN || event.data?.type !== 'spmt.surface.updated') return;
      void refresh();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refresh]);

  React.useEffect(() => {
    if (hiddenRoute || embedded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.altKey && event.shiftKey && event.key.toLowerCase() === 'f')) return;
      event.preventDefault(); setOpen(false);
      setFooterVisible((current) => {
        const next = !current;
        window.localStorage.setItem(FOOTER_VISIBILITY_KEY, next ? '1' : '0');
        return next;
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [embedded, hiddenRoute]);

  if (hiddenRoute || embedded || !footerVisible) return null;

  const traySlots = tokens?.dockSlots?.length ? tokens.dockSlots : fallbackSlots();
  const activeSlot = target.kind === 'slot' ? traySlots.find((slot) => slot.id === target.id) || null : null;
  const panelUrl = target.kind === 'slot' ? String(activeSlot?.url || '').trim() : String(surfaceUrls[target.id] || '').trim();
  const panelTitle = target.kind === 'slot' ? (activeSlot?.title || `Slot ${target.id}`) : (SURFACE_CONTROLS.find((item) => item.id === target.id)?.label || 'Workspace');

  const openSlot = (slot: WorkspaceDockSlotV1) => {
    if (!connected) { setOpen(true); return; }
    setTarget({ kind: 'slot', id: slot.id }); setOpen(true);
  };
  const openSurface = (id: SurfaceId) => {
    if (!connected) { setOpen(true); return; }
    setTarget({ kind: 'surface', id }); setOpen(true);
  };
  const togglePersonalOverlay = () => {
    const next = !personalOverlayVisible;
    window.localStorage.setItem(PERSONAL_VISIBILITY_KEY, next ? '1' : '0');
    setPersonalOverlayVisible(next);
    window.dispatchEvent(new CustomEvent(PERSONAL_VISIBILITY_EVENT, { detail: { visible: next } }));
  };
  const copyOutput = (url?: string) => {
    if (!url) return;
    const pending = navigator.clipboard?.writeText(url);
    if (pending) void pending.catch(() => undefined);
  };

  return <>
    {open && <section className="fixed inset-x-3 bottom-[76px] z-[100] mx-auto flex h-[min(72vh,700px)] max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/90 shadow-2xl backdrop-blur-xl sm:inset-x-6">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 p-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {connected ? <>
            {traySlots.map((slot) => <button key={slot.id} type="button" onClick={() => setTarget({ kind: 'slot', id: slot.id })} className={`rounded-lg px-3 py-2 text-sm font-medium ${target.kind === 'slot' && target.id === slot.id ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}>{slot.title || `Slot ${slot.id}`}</button>)}
            {SURFACE_CONTROLS.map(({ id, label }) => <button key={id} type="button" disabled={!surfaceUrls[id]} onClick={() => setTarget({ kind: 'surface', id })} className={`rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-30 ${target.kind === 'surface' && target.id === id ? 'bg-cyan-300/15 text-cyan-100' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}>{label}</button>)}
          </> : <span className="px-2 text-xs font-semibold text-amber-200">SPMT workspace disconnected</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1 border-l border-white/10 pl-2">
          {connected ? <button type="button" onClick={togglePersonalOverlay} className={`rounded-lg px-2.5 py-2 text-xs font-bold ${personalOverlayVisible ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/5 text-white/55'}`} aria-pressed={personalOverlayVisible}>Personal overlay {personalOverlayVisible ? 'On' : 'Off'}</button> : null}
          {tenantOutputs?.public ? <button type="button" onClick={() => copyOutput(tenantOutputs.public)} className="rounded-lg px-2.5 py-2 text-xs font-medium text-white/65 hover:bg-white/10 hover:text-white">Copy Public URL</button> : null}
          {tenantOutputs?.personal ? <button type="button" onClick={() => copyOutput(tenantOutputs.personal)} className="rounded-lg px-2.5 py-2 text-xs font-medium text-white/65 hover:bg-white/10 hover:text-white">Copy Personal URL</button> : null}
          {SURFACE_CONTROLS.slice(1).map(({ id, label, Icon }) => <button key={id} type="button" onClick={() => openSurface(id)} disabled={!surfaceUrls[id]} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-white/65 hover:bg-white/10 hover:text-white disabled:opacity-30" title={`Open canonical ${label}`}><Icon className="h-4 w-4" aria-hidden /><span className="hidden md:inline">{label}</span></button>)}
          <button type="button" onClick={() => setOpen(false)} className="inline-flex items-center rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close workspace"><X className="h-4 w-4" aria-hidden /></button>
        </div>
      </header>

      {!loaded ? <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-white/70"><RefreshCw className="h-7 w-7 animate-spin" aria-hidden /><p className="text-sm">Connecting to your SPMT workspace…</p></div>
        : !connected ? <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-white/75"><LayoutGrid className="h-9 w-9 text-amber-300" aria-hidden /><div><p className="font-semibold text-white">HearMeOut is open, but the shared SPMT workspace is not connected.</p><p className="mt-1 max-w-lg text-sm text-white/55">Reconnect SPMT to restore your Worktray, shared appearance, workspace URLs, and Personal overlay.</p></div><a href={reconnectHref} className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-200">Reconnect SPMT workspace</a></div>
          : panelUrl ? <iframe key={`${target.kind}:${String(target.id)}:${panelUrl}`} src={panelUrl} title={panelTitle} className="min-h-0 flex-1 border-0 bg-transparent" allow="autoplay; microphone; camera; fullscreen; clipboard-write" />
            : <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-white/70"><LayoutGrid className="h-8 w-8" aria-hidden /><p className="text-sm">{target.kind === 'slot' ? 'This workspace slot has no URL assigned yet.' : 'That canonical SPMT surface is currently unavailable.'}</p><button type="button" onClick={() => openSurface('worktray')} className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">Open canonical Workspace</button></div>}
    </section>}

    <aside className="fixed inset-x-3 bottom-3 z-[110] mx-auto max-w-5xl overflow-hidden rounded-2xl border border-white/15 bg-black/80 shadow-[0_-14px_42px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:inset-x-6" aria-label="SPMT workspace tray" data-workspace-footer="true">
      <div className="flex min-h-14 items-center gap-2 p-2">
        <button type="button" onClick={() => open && target.kind === 'surface' && target.id === 'worktray' ? setOpen(false) : openSurface('worktray')} className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold text-white ${open && target.kind === 'surface' && target.id === 'worktray' ? 'border-cyan-300/40 bg-cyan-300/10' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'}`} aria-expanded={open}>
          <LayoutGrid className="h-4 w-4 text-cyan-300" aria-hidden /><span className="hidden sm:inline">Workspace</span>
          {!loaded ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" title="Checking SPMT" /> : connected ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="SPMT connected" /> : <span className="h-1.5 w-1.5 rounded-full bg-amber-300" title="SPMT reconnect required" />}
        </button>
        <div className="grid min-w-0 flex-1 grid-cols-3 gap-1.5">
          {traySlots.map((slot) => <button key={slot.id} type="button" onClick={() => openSlot(slot)} className={`min-w-0 rounded-xl border px-2.5 py-2 text-left ${connected && target.kind === 'slot' && target.id === slot.id && open ? 'border-cyan-300/35 bg-cyan-300/[0.08]' : 'border-white/10 bg-white/[0.025] hover:bg-white/[0.06]'}`}><span className="block truncate text-[10px] font-bold text-white">{connected ? (slot.title || `Slot ${slot.id}`) : `Slot ${slot.id}`}</span><span className="mt-0.5 block text-[8px] font-semibold uppercase tracking-wide text-white/35">{connected ? (slot.collapsed ? 'Hidden' : `Slot ${slot.id}`) : 'SPMT offline'}</span></button>)}
        </div>
        {!connected && loaded ? <a href={reconnectHref} className="hidden shrink-0 items-center gap-1.5 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[10px] font-bold text-amber-100 hover:bg-amber-300/15 md:inline-flex"><RefreshCw className="h-3.5 w-3.5" aria-hidden />Reconnect</a> : null}
      </div>
    </aside>
  </>;
}
