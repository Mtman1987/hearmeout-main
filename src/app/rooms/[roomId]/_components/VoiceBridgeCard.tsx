"use client";

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle, Radio } from 'lucide-react';

const VOICE_CHANNEL_TYPES = new Set([2, 13]);

type Guild = { id: string; name: string };
type Channel = { id: string; name: string; type: number };

type BridgeState = {
  config: {
    enabled: boolean;
    guildId: string;
    voiceChannelId: string;
    roomVoiceOutboundEnabled?: boolean;
    audioProfile?: 'low-latency' | 'balanced' | 'resilient';
  };
  worker?: {
    running?: boolean;
    discordSpeakers?: number;
    appSources?: number;
    roomVoiceOutboundEnabled?: boolean;
    mode?: 'two-way' | 'listen-only';
    audioProfile?: 'low-latency' | 'balanced' | 'resilient';
    discordSelfMute?: boolean;
    discordServerMute?: boolean;
    discordSuppressed?: boolean;
    discordJitter?: {
      targetMs?: number;
      bufferedMs?: number;
      arrivalJitterMs?: number;
      underruns?: number;
      droppedFrames?: number;
      captureErrors?: number;
    };
    noiseCancellation?: { krispEnabled?: boolean; captureProcessing?: string; reason?: string };
  };
};

export function VoiceBridgeCard({ roomId }: { roomId: string }) {
  const { toast } = useToast();
  const [guilds, setGuilds] = React.useState<Guild[]>([]);
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [guildId, setGuildId] = React.useState('');
  const [voiceChannelId, setVoiceChannelId] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const channelRequest = React.useRef(0);
  const serverSelectId = React.useId();
  const channelSelectId = React.useId();
  const [roomVoiceOutboundEnabled, setRoomVoiceOutboundEnabled] = React.useState(true);
  const [audioProfile, setAudioProfile] = React.useState<'low-latency' | 'balanced' | 'resilient'>('balanced');
  const [status, setStatus] = React.useState<BridgeState['worker']>();
  const [loadingChannels, setLoadingChannels] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const applyWorkerState = React.useCallback((worker?: BridgeState['worker']) => {
    setStatus(worker);
    if (typeof worker?.running === 'boolean') setRunning(worker.running);
    if (typeof worker?.roomVoiceOutboundEnabled === 'boolean') {
      setRoomVoiceOutboundEnabled(worker.roomVoiceOutboundEnabled);
    }
    if (worker?.audioProfile) setAudioProfile(worker.audioProfile);
  }, []);

  const loadChannels = React.useCallback(async (gid: string) => {
    const request = ++channelRequest.current;
    if (!gid) { setChannels([]); setLoadingChannels(false); return; }
    setLoadingChannels(true);
    setChannels([]);
    try {
      const res = await fetch(`/api/discord/channels?guildId=${encodeURIComponent(gid)}`, {
        cache: 'no-store', signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to load voice channels');
      const list: Channel[] = Array.isArray(data) ? data : [];
      if (request === channelRequest.current) setChannels(list.filter((c) => VOICE_CHANNEL_TYPES.has(Number(c.type))));
    } catch (error) {
      if (request === channelRequest.current) {
        setChannels([]);
        toast({ title: 'Voice channels unavailable', description: error instanceof Error ? error.message : 'Try Refresh servers.', variant: 'destructive' });
      }
    } finally {
      if (request === channelRequest.current) setLoadingChannels(false);
    }
  }, [toast]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [stateRes, guildsRes] = await Promise.all([
          fetch(`/api/discord/voice-bridge?roomId=${encodeURIComponent(roomId)}`),
          fetch('/api/discord/guilds', { cache: 'no-store' }),
        ]);
        const state: BridgeState = await stateRes.json().catch(() => ({} as BridgeState));
        const guildList = await guildsRes.json().catch(() => []);
        if (!alive) return;

        setGuilds(Array.isArray(guildList) ? guildList : []);
        const cfg = state?.config;
        if (cfg) {
          setGuildId(cfg.guildId || '');
          setVoiceChannelId(cfg.voiceChannelId || '');
          setRunning(state?.worker?.running ?? Boolean(cfg.enabled));
          setRoomVoiceOutboundEnabled(
            state?.worker?.roomVoiceOutboundEnabled ?? cfg.roomVoiceOutboundEnabled ?? true,
          );
          setAudioProfile(state?.worker?.audioProfile || cfg.audioProfile || 'balanced');
          if (cfg.guildId) loadChannels(cfg.guildId);
        }
        applyWorkerState(state?.worker);
      } catch {
        /* non-fatal */
      }
    })();
    return () => { alive = false; };
  }, [roomId, loadChannels, applyWorkerState]);

  React.useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/discord/voice-bridge?roomId=${encodeURIComponent(roomId)}`, { cache: 'no-store' }).catch(() => null);
      if (!response?.ok) return;
      const next: BridgeState = await response.json().catch(() => ({} as BridgeState));
      applyWorkerState(next.worker);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [roomId, running, applyWorkerState]);

  const refreshServers = React.useCallback(async () => {
    try {
      const response = await fetch('/api/discord/guilds', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to refresh Discord servers');
      setGuilds(Array.isArray(data) ? data : []);
      if (guildId) await loadChannels(guildId);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Discord servers unavailable', description: error instanceof Error ? error.message : 'Try again shortly.' });
    }
  }, [guildId, loadChannels, toast]);
  React.useEffect(() => {
    const focused = () => { void refreshServers(); };
    window.addEventListener('focus', focused);
    return () => window.removeEventListener('focus', focused);
  }, [refreshServers]);

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
        body: JSON.stringify({ roomId, action: enable ? 'start' : 'stop', guildId, voiceChannelId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.message || data.error || 'Request failed');
      setRunning(enable);
      applyWorkerState(data.status);
      toast({ title: enable ? 'Discord voice bridge started' : 'Discord voice bridge stopped' });
    } catch (err: any) {
      toast({ title: 'Voice bridge error', description: err?.message, variant: 'destructive' });
      setRunning(!enable);
    } finally {
      setBusy(false);
    }
  };

  const setRoomOutbound = async (enable: boolean) => {
    const previous = roomVoiceOutboundEnabled;
    setBusy(true);
    try {
      const res = await fetch('/api/discord/voice-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, action: 'set-room-outbound', roomVoiceOutboundEnabled: enable }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.message || data.error || 'Privacy gate change was not confirmed');
      setRoomVoiceOutboundEnabled(enable);
      applyWorkerState(data.status || status);
      toast({
        title: enable ? 'Room voice return is on' : 'Listen-only privacy is on',
        description: enable
          ? 'People in Discord can hear HearMeOut room voices.'
          : 'You still hear Discord here, but HearMeOut room voices are not sent back.',
      });
    } catch (err: any) {
      setRoomVoiceOutboundEnabled(previous);
      toast({ title: 'Privacy gate error', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const changeAudioProfile = async (profile: 'low-latency' | 'balanced' | 'resilient') => {
    const previous = audioProfile;
    setAudioProfile(profile);
    try {
      const res = await fetch('/api/discord/voice-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, action: 'set-audio-profile', audioProfile: profile }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || data.message || 'Audio profile change failed');
      applyWorkerState(data.status || status);
      toast({ title: `Discord audio: ${profile}` });
    } catch (err: any) {
      setAudioProfile(previous);
      toast({ title: 'Audio profile error', description: err?.message, variant: 'destructive' });
    }
  };

  const discordMuted = Boolean(status?.discordSelfMute || status?.discordServerMute || status?.discordSuppressed);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4" />
          Discord Voice Bridge
          {running && <Badge variant="secondary" className="ml-1">Live</Badge>}
          {running && discordMuted && <Badge variant="destructive" className="ml-1">Discord muted</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The bridge bot stays in Discord and carries that voice channel into this room. You do not
          need to join the Discord voice channel yourself. Use the privacy gate below when you want
          to hear Discord without sending this room&apos;s conversation back.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><a href="/api/discord/bot-invite" target="_blank" rel="noopener noreferrer">Add SPMT to a server</a></Button>
          <Button variant="outline" onClick={refreshServers}>Refresh servers</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={serverSelectId}>Server</Label>
            <select id={serverSelectId} value={guildId} onChange={(event) => onGuildChange(event.target.value)} disabled={running || busy}
              className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
              <option value="">Select a server</option>
              {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={channelSelectId}>Voice channel</Label>
            <select id={channelSelectId} value={voiceChannelId} onChange={(event) => setVoiceChannelId(event.target.value)} disabled={running || busy || !guildId || loadingChannels}
              className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
              <option value="">{loadingChannels ? 'Loading…' : !guildId ? 'Select a server first' : channels.length ? 'Select a voice channel' : 'No voice channels found'}</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex items-center gap-3">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            <div>
              <Label className="cursor-pointer">Enable voice bridge</Label>
              {running && status ? <p className="text-xs text-muted-foreground">{status.discordSpeakers ?? 0} Discord speaker(s) · {status.appSources ?? 0} app voice(s)</p> : null}
            </div>
          </div>
          <Switch checked={running} disabled={busy} onCheckedChange={(checked) => setBridge(checked)} />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div className="min-w-0">
            <Label className="cursor-pointer">Let Discord hear this room</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {roomVoiceOutboundEnabled ? 'Two-way: HearMeOut room voices are sent to Discord.' : 'Listen-only: Discord stays audible here, but this room stays private.'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Music uses its own bridge lane and is not muted by this room-voice gate.</p>
          </div>
          <Switch checked={roomVoiceOutboundEnabled} disabled={busy} aria-label="Let Discord hear this HearMeOut room" onCheckedChange={(checked) => setRoomOutbound(checked)} />
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <div>
            <Label>Discord → LiveKit reliability</Label>
            <p className="mt-1 text-xs text-muted-foreground">Balanced adapts to normal jitter. Use Resilient when the connection is dropping packets; Low latency is best only on a clean route.</p>
          </div>
          <Select value={audioProfile} onValueChange={(value) => changeAudioProfile(value as typeof audioProfile)} disabled={busy}>
            <SelectTrigger aria-label="Discord audio reliability profile"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low-latency">Low latency</SelectItem>
              <SelectItem value="balanced">Balanced</SelectItem>
              <SelectItem value="resilient">Resilient / slow internet</SelectItem>
            </SelectContent>
          </Select>
          {running && status?.discordJitter ? <p className="text-xs text-muted-foreground">Buffer {status.discordJitter.bufferedMs ?? 0} ms / {status.discordJitter.targetMs ?? 0} ms · network jitter {status.discordJitter.arrivalJitterMs ?? 0} ms · underruns {status.discordJitter.underruns ?? 0} · dropped {status.discordJitter.droppedFrames ?? 0}</p> : null}
          <p className="text-xs text-muted-foreground">Krisp: not applied to this server-published Discord PCM track. Browser WebRTC echo/noise cancellation still applies to human microphones; the bridge fixes transport jitter before LiveKit ingest.</p>
        </div>
      </CardContent>
    </Card>
  );
}
