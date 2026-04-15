'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCollection } from '@/hooks/use-db';
import { dbDelete } from '@/lib/db-helpers';
import { Users, X } from 'lucide-react';

interface QueueEntry {
  id: string;
  userId: string;
  username: string;
  addedAt: string;
  platform: string;
}

export default function VoiceQueue({ roomId }: { roomId: string }) {
  const { data: queue } = useCollection<QueueEntry>(`rooms/${roomId}/voiceQueue`, {
    orderBy: 'addedAt', orderDir: 'asc',
  });

  const handleNext = async () => {
    if (!queue || queue.length === 0) return;
    const nextPerson = queue[0];
    const roomUrl = `${window.location.origin}/rooms/${roomId}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const expiresStr = expiresAt.toLocaleTimeString();

    if (nextPerson.platform === 'discord') {
      try {
        const res = await fetch('/api/discord/send-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: nextPerson.userId, roomUrl, expiresAt: expiresStr }),
        });
        if (res.ok) alert(`Invite sent to ${nextPerson.username} via Discord DM!`);
        else throw new Error('Failed');
      } catch {
        alert(`Failed to send Discord DM. Copy link manually:\n${roomUrl}\nExpires: ${expiresStr}`);
        navigator.clipboard.writeText(`${roomUrl} (expires at ${expiresStr})`);
      }
    } else {
      navigator.clipboard.writeText(`${roomUrl} (expires at ${expiresStr})`);
      alert(`Link copied! Send to ${nextPerson.username} via Twitch whisper.\nExpires: ${expiresStr}`);
    }

    dbDelete(`rooms/${roomId}/voiceQueue`, nextPerson.id);
  };

  const handleRemove = (id: string) => dbDelete(`rooms/${roomId}/voiceQueue`, id);

  if (!queue || queue.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Voice Chat Queue ({queue.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {queue.map((entry, index) => (
            <div key={entry.id} className="flex items-center justify-between p-2 bg-muted rounded">
              <span className="text-sm">#{index + 1} - {entry.username} ({entry.platform})</span>
              <Button size="sm" variant="ghost" onClick={() => handleRemove(entry.id)}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button onClick={handleNext} className="w-full">Next Person</Button>
        </div>
      </CardContent>
    </Card>
  );
}
