'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';

const SPMT_ORIGIN = 'https://spmt.live';

export function PersonalOverlayHost() {
  const pathname = usePathname();
  const hiddenRoute = /^\/(api|auth|login|embed|headless|activity)(\/|$)/.test(pathname)
    || pathname.startsWith('/overlay/')
    || pathname === '/quackverse-overlay';
  const [embedded, setEmbedded] = React.useState(true);
  const [url, setUrl] = React.useState('');

  const refresh = React.useCallback(async () => {
    if (hiddenRoute) return;
    try {
      const response = await fetch('/api/spmt/workspace-theme', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) return setUrl('');
      const body = await response.json().catch(() => ({}));
      setUrl(typeof body?.personalOverlayUrl === 'string' ? body.personalOverlayUrl : '');
    } catch {
      setUrl('');
    }
  }, [hiddenRoute]);

  React.useEffect(() => {
    const isEmbedded = window.self !== window.top;
    setEmbedded(isEmbedded);
    if (!isEmbedded) void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (hiddenRoute || embedded) return;
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    const onMessage = (event: MessageEvent) => {
      if (event.origin === SPMT_ORIGIN && event.data?.type === 'spmt.surface.updated') void refresh();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('message', onMessage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('message', onMessage);
    };
  }, [embedded, hiddenRoute, refresh]);

  if (embedded || hiddenRoute || !url) return null;
  return <iframe
    src={url}
    title="SPMT Personal overlay"
    aria-hidden="true"
    className="pointer-events-none fixed inset-0 z-[90] h-screen w-screen border-0 bg-transparent"
    allow="autoplay"
  />;
}
