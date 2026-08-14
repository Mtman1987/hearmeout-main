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
  isOwner?: boolean;
  canInvite?: boolean;
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
        <Button variant="ghost" size="sm" className="h-8 gap-1.5" title="Invite a bot">
          <Bot className="h-4 w-4" />
          <span className="hidden sm:inline">Bots</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a bot</DialogTitle>
          <DialogDescription>
            Bots shown here are yours or have been shared for public room use.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading bots…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && bots.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No bots are available to invite.</p>
        )}

        {!loading && bots.length > 0 && (
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {bots.map((bot) => (
              <div key={bot.id} className="flex items-center gap-3 rounded-md border p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{bot.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {bot.isOwner ? 'Your bot' : `Owned by ${bot.ownerName || 'another user'}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={!bot.canInvite || joiningId === bot.id}
                  onClick={() => joinBot(bot)}
                >
                  {joiningId === bot.id
                    ? <LoaderCircle className="h-4 w-4 animate-spin" />
                    : <LogIn className="h-4 w-4" />}
                  Join
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
