'use client';

import { useEffect, useState } from 'react';
import { Bot, LoaderCircle, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export type AvailableRoomBot = {
  id: string;
  name: string;
  ownerName?: string;
  ownerTenantId: string;
  aliases?: string[];
  wakeNames?: string[];
  interests?: string[];
  avatar?: string;
  idleAvatar?: string;
  talkingAvatar?: string;
  canInvite?: boolean;
  canTalk?: boolean;
  blockedReason?: string;
};

type BotPickerProps = {
  roomId: string;
  onJoined?: (bot: AvailableRoomBot) => void;
};

export async function fetchAvailableRoomBots(): Promise<AvailableRoomBot[]> {
  const response = await fetch('/api/bots', { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error?.message || payload?.error || 'Could not load bots'));
  }
  const bots = payload?.data?.bots || payload?.bots || [];
  return Array.isArray(bots) ? bots : [];
}

export async function changeRoomBotSession(
  roomId: string,
  bot: string,
  action: 'join' | 'leave',
): Promise<{ bot?: AvailableRoomBot; message?: string }> {
  const response = await fetch('/api/bots/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, roomId, bot }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error?.message || payload?.error || `Could not ${action} bot`));
  }
  return payload;
}

export default function BotPicker({ roomId, onJoined }: BotPickerProps) {
  const [open, setOpen] = useState(false);
  const [bots, setBots] = useState<AvailableRoomBot[]>([]);
  const [loading, setLoading] = useState(false);
  const [joiningId, setJoiningId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchAvailableRoomBots()
      .then((items) => { if (!cancelled) setBots(items); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const joinBot = async (bot: AvailableRoomBot) => {
    setJoiningId(bot.id);
    setError('');
    try {
      const result = await changeRoomBotSession(roomId, bot.id, 'join');
      onJoined?.(result.bot || bot);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setJoiningId('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5" title="Meet an SPMT bot">
          <Bot className="h-4 w-4" />
          <span className="hidden sm:inline">Bots</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Meet the SPMT bots</DialogTitle>
          <DialogDescription>
            Invite any SPMT persona, talk with it, and get to know the streamer behind it. Bot Share does not control human conversation.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading SPMT personas…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && bots.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No SPMT personas are configured yet.</p>
        )}

        {!loading && bots.length > 0 && (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {bots.map((bot) => {
              const avatar = bot.idleAvatar || bot.avatar;
              const interestLine = (bot.interests || []).slice(0, 3).join(' • ');
              const blocked = bot.canInvite === false || bot.canTalk === false;
              return (
                <div key={bot.id} className="flex items-center gap-3 rounded-md border p-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                    {avatar
                      ? <img src={avatar} alt="" className="h-full w-full object-cover" />
                      : <Bot className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{bot.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Streamer: {bot.ownerName || bot.ownerTenantId}
                    </p>
                    {interestLine && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{interestLine}</p>
                    )}
                    {blocked && bot.blockedReason && (
                      <p className="mt-1 text-xs text-muted-foreground">{bot.blockedReason}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={blocked || joiningId === bot.id}
                    onClick={() => joinBot(bot)}
                  >
                    {joiningId === bot.id
                      ? <LoaderCircle className="h-4 w-4 animate-spin" />
                      : <LogIn className="h-4 w-4" />}
                    {blocked ? 'Unavailable' : 'Invite'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
