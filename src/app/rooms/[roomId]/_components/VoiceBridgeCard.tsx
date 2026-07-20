"use client";

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle, Radio } from 'lucide-react';

// Discord channel type ids we treat as "voice".
const VOICE_CHANNEL_TYPES = new Set([2, 13]); // GUILD_VOICE, GUILD_STAGE_VOICE

type Guild = { id: string; name: string };
type Channel = { id: string; name: string; type: number };

type BridgeState = {
  config: { enabled: boolean; guildId: string; voiceChannelId: string };
  worker?: { running?: boolean; discordSpeakers?: number; appSources?: number };
};

export function VoiceBridgeCard({ roomId }: { roomId: string }) {
  const { toast } = useToast();
  const [guilds, setGuilds] = React.useState<Guild[]>([]);
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [guildId, setGuildId] = React.useState('');
  const [voiceChannelId, setVoiceChannelId] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [status, setStatus] = React.useState<BridgeState['worker']>();
  const [loadingChannels, setLoadingChannels] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const loadChannels = React.useCallback(async (gid: string) => {
    if (!gid) { setChannels([]); return; }
    setLoadingChannels(true);
    try {
      const res = await fetch(`/api/discord/channels?guildId=${encodeURIComponent(gid)}`);
      const data = await res.json();
      const list: Channel[] = Array.isArray(data) ? data : [];
      setChannels(list.filter((c) => VOICE_CHANNEL_TYPES.has(c.type)));
    } catch {
      setChannels([]);
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  // Initial load: saved config + guild list.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [stateRes, guildsRes] = await Promise.all([
          fetch(`/api/discord/voice-bridge?roomId=${encodeURIComponent(roomId)}`),
          fetch('/api/discord/guilds'),
        ]);
        const state: BridgeState = await stateRes.json().catch(() => ({} as BridgeState));
        const guildList = await guildsRes.json().catch(() => []);
        if (!alive) return;

        setGuilds(Array.isArray(guildList) ? guildList : []);
        const cfg = state?.config;
        if (cfg) {
          setGuildId(cfg.guildId || '');
          setVoiceChannelId(cfg.voiceChannelId || '');
          setRunning(Boolean(state?.worker?.running || cfg.enabled));
          setStatus(state?.worker);
          if (cfg.guildId) loadChannels(cfg.guildId);
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => { alive = false; };
  }, [roomId, loadChannels]);

  const onGuildChange = (value: string) => {
    setGuildId(value);
    setVoiceChannelId('');
    loadChannels(value);
  };

  const setBridge = async (enable: boolean) => {
    if (enable && (!guildId || !voiceChannelId)) {
      toast({ title: 'Pick a server and voice channel first', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/discord/voice-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          action: enable ? 'start' : 'stop',
          guildId,
          voiceChannelId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.message || data.error || 'Request failed');
      }
      setRunning(enable);
      setStatus(data.status);
      toast({ title: enable ? 'Discord voice bridge started' : 'Discord voice bridge stopped' });
    } catch (err: any) {
      toast({ title: 'Voice bridge error', description: err?.message, variant: 'destructive' });
      setRunning(!enable);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4" />
          Discord Voice Bridge
          {running && <Badge variant="secondary" className="ml-1">Live</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Bring a Discord voice channel into this room. Each Discord speaker shows up as their own
          card, and everyone in the room is mixed back into Discord through the bot.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Server</Label>
            <Select value={guildId} onValueChange={onGuildChange} disabled={running || busy}>
              <SelectTrigger>
                <SelectValue placeholder="Select a server" />
              </SelectTrigger>
              <SelectContent>
                {guilds.map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Voice channel</Label>
            <Select
              value={voiceChannelId}
              onValueChange={setVoiceChannelId}
              disabled={running || busy || !guildId || loadingChannels}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingChannels ? 'Loading…' : 'Select a voice channel'} />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex items-center gap-3">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            <div>
              <Label className="cursor-pointer">Enable voice bridge</Label>
              {running && status ? (
                <p className="text-xs text-muted-foreground">
                  {status.discordSpeakers ?? 0} Discord speaker(s) · {status.appSources ?? 0} app voice(s)
                </p>
              ) : null}
            </div>
          </div>
          <Switch
            checked={running}
            disabled={busy}
            onCheckedChange={(checked) => setBridge(checked)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
