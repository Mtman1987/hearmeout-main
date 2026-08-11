'use client';

import * as React from 'react';
import { ExternalLink, LayoutGrid, PanelsTopLeft, Settings, X } from 'lucide-react';
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

export function SpmtWorkspaceHost() {
  const pathname = usePathname();
  const hiddenRoute = /^\/(api|auth|login|embed|headless|activity)(\/|$)/.test(pathname) || pathname.startsWith('/overlay/') || pathname === '/quackverse-overlay';
  const [embedded, setEmbedded] = React.useState(true);
  const [connected, setConnected] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [tokens, setTokens] = React.useState<WorkspaceThemeTokensV1 | null>(null);
  const [activeSlotId, setActiveSlotId] = React.useState<number | null>(null);

  const refresh = React.useCallback(async () => {
    if (hiddenRoute) return;
    try {
      const response = await fetch('/api/spmt/workspace-theme', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) { setConnected(false); return; }
      const body = await response.json().catch(() => ({}));
      if (!body?.tokens) return;
      const nextTokens = body.tokens as WorkspaceThemeTokensV1;
      setTokens(nextTokens);
      const slots = usableSlots(nextTokens);
      setActiveSlotId((current) => slots.some((slot) => slot.id === current) ? current : (slots[0]?.id ?? null));
      setConnected(true);
    } catch { setConnected(false); }
  }, [hiddenRoute]);

  React.useEffect(() => { setEmbedded(window.self !== window.top); void refresh(); }, [refresh]);
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== SPMT_ORIGIN || event.data?.type !== 'spmt.surface.updated') return;
      void refresh().finally(() => window.dispatchEvent(new Event('focus')));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refresh]);

  if (hiddenRoute || embedded || !connected) return null;
  const slots = usableSlots(tokens);
  const activeSlot = slots.find((slot) => slot.id === activeSlotId) || slots[0] || null;
  const overlay = tokens?.overlayWorkspace;
  const widgets = overlay?.enabled ? (overlay.widgets || []).filter((widget) => widget.visible && widget.url) : [];
  const slotButton = (slot: WorkspaceDockSlotV1) => <button key={slot.id} type="button" onClick={() => setActiveSlotId(slot.id)} className={`rounded-lg px-3 py-2 text-sm font-medium ${activeSlot?.id === slot.id ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}>{slot.title || `Slot ${slot.id}`}</button>;

  return <>
    <div aria-hidden={!overlay?.enabled} className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">{widgets.map((widget) => { const rawOpacity = Number(widget.opacity ?? 1); const opacity = rawOpacity > 1 ? rawOpacity / 100 : rawOpacity; return <iframe key={widget.id} src={widget.url} title={widget.title || widget.id} className={widget.interactive ? 'pointer-events-auto absolute border-0 bg-transparent' : 'pointer-events-none absolute border-0 bg-transparent'} style={{ left: widget.x, top: widget.y, width: widget.width, height: widget.height, opacity: Math.max(0, Math.min(1, opacity)) }} allow="autoplay; microphone; camera; fullscreen; clipboard-write" />; })}</div>
    {open && <section className="fixed inset-x-3 bottom-16 z-[100] mx-auto flex h-[min(78vh,760px)] max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/85 shadow-2xl backdrop-blur-xl sm:inset-x-6"><header className="flex flex-wrap items-center gap-2 border-b border-white/10 p-2"><div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{slots.map(slotButton)}</div><div className="flex items-center gap-1 border-l border-white/10 pl-2">{MANAGEMENT_LINKS.map(({ label, href, Icon }) => <a key={label} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-white/65 hover:bg-white/10 hover:text-white" title={`Manage ${label} in SpaceMountainLive`}><Icon className="h-4 w-4" aria-hidden /><span className="hidden md:inline">{label}</span><ExternalLink className="h-3 w-3 opacity-60" aria-hidden /></a>)}<button type="button" onClick={() => setOpen(false)} className="inline-flex items-center rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close workspace"><X className="h-4 w-4" aria-hidden /></button></div></header>{activeSlot ? <iframe key={`${activeSlot.id}:${activeSlot.url}`} src={activeSlot.url} title={activeSlot.title || `Workspace slot ${activeSlot.id}`} className="min-h-0 flex-1 border-0 bg-transparent" allow="autoplay; microphone; camera; fullscreen; clipboard-write" /> : <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-white/70"><LayoutGrid className="h-8 w-8" aria-hidden /><p className="text-sm">This workspace has no URLs assigned yet.</p><a href={MANAGEMENT_LINKS[0].href} target="_blank" rel="noreferrer" className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">Manage Workspace in SpaceMountainLive</a></div>}</section>}
    <button type="button" onClick={() => setOpen((value) => !value)} className="fixed bottom-3 right-3 z-[110] inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/75 px-4 py-2.5 text-sm font-semibold text-white shadow-xl backdrop-blur-xl transition hover:bg-black/90 sm:right-5" aria-expanded={open}><LayoutGrid className="h-4 w-4" aria-hidden /><span>Workspace</span></button>
  </>;
}
