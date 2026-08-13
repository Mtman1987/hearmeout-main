'use client';

import { PersonalOverlayOpacityControl } from '@/components/personal-overlay-opacity-control';

export default function Template({ children }: { children: React.ReactNode }) {
  return <>
    {children}
    <PersonalOverlayOpacityControl storageKey="hearmeout:personal-overlay-opacity" />
  </>;
}
