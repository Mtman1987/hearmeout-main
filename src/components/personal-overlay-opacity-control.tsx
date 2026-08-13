'use client';

import * as React from 'react';

type Props = { storageKey: string };
const PERSONAL_SELECTOR = '[data-canonical-personal-overlay="true"]';

function clampOpacity(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 100;
}

export function PersonalOverlayOpacityControl({ storageKey }: Props) {
  const [opacity, setOpacity] = React.useState(100);
  const [available, setAvailable] = React.useState(false);

  React.useEffect(() => {
    setOpacity(clampOpacity(window.localStorage.getItem(storageKey) ?? 100));
  }, [storageKey]);

  React.useEffect(() => {
    const apply = () => {
      const layers = Array.from(document.querySelectorAll<HTMLElement>(PERSONAL_SELECTOR));
      setAvailable(layers.length > 0);
      const factor = opacity / 100;
      layers.forEach((layer) => {
        layer.style.filter = `opacity(${factor})`;
        layer.dataset.localPersonalOpacity = String(opacity);
      });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [opacity]);

  const changeOpacity = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = clampOpacity(event.target.value);
    setOpacity(next);
    window.localStorage.setItem(storageKey, String(next));
  };

  if (!available) return null;
  return <label className="fixed bottom-20 right-4 z-[120] flex items-center gap-2 rounded-xl border border-white/15 bg-black/80 px-3 py-2 text-[10px] font-bold text-white shadow-xl backdrop-blur-xl" title="Local only. Does not change Overlay Bay or other apps.">
    <span className="whitespace-nowrap">Personal {opacity}%</span>
    <input type="range" min="0" max="100" step="5" value={opacity} onChange={changeOpacity} aria-label="Local Personal overlay opacity" className="w-24 accent-cyan-300" />
  </label>;
}
