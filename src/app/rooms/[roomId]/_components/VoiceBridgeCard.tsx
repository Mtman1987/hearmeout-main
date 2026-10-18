"use client";

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { LoaderCircle, Radio, Settings2, SlidersHorizontal } from 'lucide-react';

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
    transport?: 'livekit' | 'peerjs';
    peerFallback?: boolean;
    discordSpeakers?: number;
    discordPresence?: { displayName?: string; photoURL?: string; source?: string };
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
  const [showSetup, setShowSetup] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);

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
          setRunning(state?.worker?.running ?? false);
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
      setShowSetup(true);
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
      const confirmedRunning = typeof data.status?.running === 'boolean' ? data.status.running : enable;
      setRunning(confirmedRunning);
      applyWorkerState(data.status);
      const alreadyRunning = enable && /already running/i.test(String(data.message || ''));
      toast({
        title: alreadyRunning ? 'Discord voice bridge already running' : enable ? 'Discord voice bridge started' : 'Discord voice bridge stopped',
        description: alreadyRunning
          ? 'The Discord bot is already connected. The hidden stream listener is a separate receive-only connection and does not control this bridge.'
          : undefined,
      });
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
  const activeSpeakerName = status?.discordPresence?.displayName || 'Discord VC';
  const activeSpeakerPhoto = status?.discordPresence?.photoURL || '';
  const hasActiveSpeaker = activeSpeakerName !== 'Discord VC';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <Radio className="h-4 w-4 shrink-0" />
          <span className="truncate">Discord Voice Bridge</span>
          {running && <Badge variant="secondary" className="ml-1">Live</Badge>}
          {running && discordMuted && <Badge variant="destructive" className="ml-1">Discord muted</Badge>}
        </CardTitle>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant={showSetup ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" aria-label={showSetup ? 'Hide Discord bridge connection settings' : 'Show Discord bridge connection settings'} aria-expanded={showSetup} onClick={() => setShowSetup((open) => !open)}>
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button type="button" variant={showAdvanced ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" aria-label={showAdvanced ? 'Hide Discord bridge advanced settings' : 'Show Discord bridge advanced settings'} aria-expanded={showAdvanced} onClick={() => setShowAdvanced((open) => !open)}>
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-3 sm:p-4">
        {running && (
          <div className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5">
            <Avatar className="h-8 w-8 shrink-0">
              {activeSpeakerPhoto ? <AvatarImage src={activeSpeakerPhoto} alt={activeSpeakerName} /> : null}
              <AvatarFallback>{hasActiveSpeaker ? activeSpeakerName.slice(0, 1).toUpperCase() : 'DC'}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{activeSpeakerName}</p>
              <p className="text-xs text-muted-foreground">{hasActiveSpeaker ? 'Active Discord speaker' : 'Waiting for Discord speech'}</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">Enable voice bridge</p>
            <p className="text-xs text-muted-foreground">
              {running && status
                ? `${status.transport === 'peerjs' ? 'PeerJS fallback' : 'LiveKit'} · ${status.discordSpeakers ?? 0} Discord speaker(s) · ${status.appSources ?? 0} app voice(s)`
                : 'Connect this room to a Discord voice channel.'}
            </p>
          </div>
          <Switch checked={running} disabled={busy} aria-label="Enable voice bridge" onCheckedChange={(checked) => setBridge(checked)} />
        </div>

        {showSetup && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Choose the Discord server and voice channel for this room.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild><a href="/api/discord/bot-invite" target="_blank" rel="noopener noreferrer">Add SPMT to a server</a></Button>
              <Button variant="outline" size="sm" onClick={refreshServers}>Refresh servers</Button>
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
          </div>
        )}

        {showAdvanced && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <Label className="cursor-pointer">Let Discord hear this room</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {roomVoiceOutboundEnabled ? 'Two-way: HearMeOut room voices are sent to Discord.' : 'Listen-only: Discord stays audible here, but this room stays private.'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Music uses its own bridge lane and is not muted by this room-voice gate.</p>
              </div>
              <Switch checked={roomVoiceOutboundEnabled} disabled={busy} aria-label="Let Discord hear this HearMeOut room" onCheckedChange={(checked) => setRoomOutbound(checked)} />
            </div>

            <div className="space-y-2">
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
