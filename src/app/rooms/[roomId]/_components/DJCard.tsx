'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { getMusicWatchSessionId } from '@/lib/watch-session';

interface DJCardProps {
  roomId: string;
  localVolume: number;
  // eslint-disable-next-line no-unused-vars
  onVolumeChange: (v: number) => void;
  canControl: boolean;
  onOpenQueue: () => void;
  onOpenAddSong: () => void;
  onOpenWatch?: () => void;
}

export default function DJCard({ localVolume, onVolumeChange, onOpenQueue, onOpenAddSong, onOpenWatch }: DJCardProps) {
  const [title, setTitle] = useState('Waiting for a request');
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const response = await fetch(`/api/watch/sessions/${getMusicWatchSessionId()}/state`, { cache: 'no-store' }).catch(() => null);
      if (!response?.ok) return;
      const state = await response.json();
      if (!cancelled) setTitle(state.current?.item.title || 'Waiting for a request');
    };
    void refresh(); const timer = setInterval(refresh, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  return <Card><CardContent className="space-y-4 p-4">
    <p className="font-semibold">Music</p><p className="truncate">{title}</p>
    <label className="flex items-center gap-3 text-sm">My volume
      <Slider aria-label="Personal music volume" value={[localVolume]} onValueChange={([value]) => onVolumeChange(value)} max={1} step={0.01} />
      <span>{Math.round(localVolume * 100)}%</span>
    </label>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={onOpenAddSong}>Request</Button>
      <Button variant="outline" size="sm" onClick={onOpenQueue}>Queue</Button>
      {onOpenWatch && <Button variant="outline" size="sm" onClick={onOpenWatch}>Open player</Button>}
    </div>
  </CardContent></Card>;
}
