"use client";

import * as React from 'react';
import type { RemoteParticipant } from 'livekit-client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle, Radio, Settings2, Volume2, VolumeX } from 'lucide-react';

const VOICE_CHANNEL_TYPES = new Set([2, 13]);

type Guild = { id: string; name: string };
type Channel = { id: string; name: string; type: number };
type DiscordMember = {
  id: string;
  displayName: string;
  photoURL?: string;
  speaking?: boolean;
};

type BridgeState = {
  config?: {
    enabled?: boolean;
    guildId?: string;
    voiceChannelId?: string;
    roomVoiceOutboundEnabled?: boolean;
    audioProfile?: 'low-latency' | 'balanced' | 'resilient';
  };
  worker?: {
    running?: boolean;
    discordSpeakers?: number;
    discordHumanCount?: number;
    discordMembers?: DiscordMember[];
    activeDiscordSpeakers?: string[];
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
    voiceEncoding?: {
      sampleRate?: number;
      channels?: number;
      lane?: string;
      ttsIncluded?: boolean;
      musicIncluded?: boolean;
    };
  };
};

export function VoiceBridgeCard({
  roomId,
  participant,
  canManage = false,
}: {
  roomId: string;
  participant?: RemoteParticipant;
  canManage?: boolean;
}) {
  const { toast } = useToast();
  const [guilds, setGuilds] = React.useState<Guild[]>([]);
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [guildId, setGuildId] = React.useState('');
  const [voiceChannelId, setVoiceChannelId] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [roomVoiceOutboundEnabled, setRoomVoiceOutboundEnabled] = React.useState(true);
  const [audioProfile, setAudioProfile] = React.useState<'low-latency' | 'balanced' | 'resilient'>('balanced');
  const [status, setStatus] = React.useState<BridgeState['worker']>();
  const [loadingChannels, setLoadingChannels] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [localVolume, setLocalVolume] = React.useState(1);
  const lastNonZeroVolume = React.useRef(1);

  React.useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(`hmo-discord-bridge-volume:${roomId}`));
      if (Number.isFinite(saved) && saved >= 0 && saved <= 1) setLocalVolume(saved);
    } catch {}
  }, [roomId]);

  React.useEffect(() => {
    if (!participant) return;
    if (localVolume > 0) lastNonZeroVolume.current = localVolume;
    if (typeof participant.setVolume === 'function') participant.setVolume(localVolume);
    try {
      window.localStorage.setItem(`hmo-discord-bridge-volume:${roomId}`, String(localVolume));
    } catch {}
  }, [participant, localVolume, roomId]);

  const applyWorkerState = React.useCallback((worker?: BridgeState['worker']) => {
    setStatus(worker);
    if (typeof worker?.running === 'boolean') setRunning(worker.running);
    if (typeof worker?.roomVoiceOutboundEnabled === 'boolean') {
      setRoomVoiceOutboundEnabled(worker.roomVoiceOutboundEnabled);
    }
    if (worker?.audioProfile) setAudioProfile(worker.audioProfile);
  }, []);

  const loadChannels = React.useCallback(async (gid: string) => {
    if (!gid) { setChannels([]); return; }
    setLoadingChannels(true);
    try {
      const res = await fetch(`/api/discord/channels?guildId=${encodeURIComponent(gid)}`);
      const data = await res.json().catch(() => []);
      const list: Channel[] = Array.isArray(data) ? data : [];
      setChannels(list.filter((c) => VOICE_CHANNEL_TYPES.has(c.type)));
    } catch {
      setChannels([]);
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  const refreshState = React.useCallback(async () => {
    const stateRes = await fetch(`/api/discord/voice-bridge?roomId=${encodeURIComponent(roomId)}`, { cache: 'no-store' }).catch(() => null);
    if (!stateRes?.ok) return;
    const state: BridgeState = await stateRes.json().catch(() => ({} as BridgeState));
    const cfg = state.config;
    if (cfg) {
      const nextGuildId = cfg.guildId || '';
      setGuildId(nextGuildId);
      setVoiceChannelId(cfg.voiceChannelId || '');
      setRunning(Boolean(state.worker?.running || cfg.enabled));
      setRoomVoiceOutboundEnabled(state.worker?.roomVoiceOutboundEnabled ?? cfg.roomVoiceOutboundEnabled ?? true);
      setAudioProfile(state.worker?.audioProfile || cfg.audioProfile || 'balanced');
      if (nextGuildId) void loadChannels(nextGuildId);
    }
    applyWorkerState(state.worker);
  }, [roomId, loadChannels, applyWorkerState]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const [stateResult, guildsResult] = await Promise.allSettled([
        fetch(`/api/discord/voice-bridge?roomId=${encodeURIComponent(roomId)}`, { cache: 'no-store' }),
        fetch('/api/discord/guilds'),
      ]);
      if (!alive) return;
      if (guildsResult.status === 'fulfilled') {
        const list = await guildsResult.value.json().catch(() => []);
        if (alive) setGuilds(Array.isArray(list) ? list : []);
      }
      if (stateResult.status === 'fulfilled' && stateResult.value.ok) {
        const state: BridgeState = await stateResult.value.json().catch(() => ({} as BridgeState));
        if (!alive) return;
        const cfg = state.config;
        if (cfg) {
          setGuildId(cfg.guildId || '');
          setVoiceChannelId(cfg.voiceChannelId || '');
          setRunning(Boolean(state.worker?.running || cfg.enabled));
          setRoomVoiceOutboundEnabled(state.worker?.roomVoiceOutboundEnabled ?? cfg.roomVoiceOutboundEnabled ?? true);
          setAudioProfile(state.worker?.audioProfile || cfg.audioProfile || 'balanced');
          if (cfg.guildId) void loadChannels(cfg.guildId);
        }
        applyWorkerState(state.worker);
      }
    })();
    return () => { alive = false; };
  }, [roomId, loadChannels, applyWorkerState]);

  React.useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => void refreshState(), 1500);
    return () => window.clearInterval(interval);
  }, [running, refreshState]);

  const onGuildChange = (value: string) => {
    setGuildId(value);
    setVoiceChannelId('');
    void loadChannels(value);
  };

  const setBridge = async (enable: boolean) => {
    if (!canManage) return;
    if (enable && (!guildId || !voiceChannelId)) {
      toast({ title: 'Pick a server and voice channel first', variant: 'destructive' });
      setShowSettings(true);
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
    } catch (err: any) {
      toast({ title: 'Voice bridge error', description: err?.message, variant: 'destructive' });
      await refreshState();
    } finally {
      setBusy(false);
    }
  };

  const setRoomOutbound = async (enable: boolean) => {
    if (!canManage) return;
    const previous = roomVoiceOutboundEnabled;
    setRoomVoiceOutboundEnabled(enable);
    setBusy(true);
    try {
      const res = await fetch('/api/discord/voice-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, action: 'set-room-outbound', roomVoiceOutboundEnabled: enable }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.message || data.error || 'Could not change Discord return audio');
      applyWorkerState(data.status || status);
    } catch (err: any) {
      setRoomVoiceOutboundEnabled(previous);
      toast({ title: 'Discord return audio error', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const changeAudioProfile = async (profile: 'low-latency' | 'balanced' | 'resilient') => {
    if (!canManage) return;
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
    } catch (err: any) {
      setAudioProfile(previous);
      toast({ title: 'Audio profile error', description: err?.message, variant: 'destructive' });
    }
  };

  const members = status?.discordMembers || [];
  const activeIds = new Set(status?.activeDiscordSpeakers || []);
  const activeMember = members.find((member) => member.speaking || activeIds.has(member.id));
  const displayMember = activeMember || members[0];
  const humanCount = status?.discordHumanCount ?? status?.discordSpeakers ?? members.length;
  const returnBlocked = Boolean(status?.discordSelfMute || status?.discordServerMute || status?.discordSuppressed);
  const locallyMuted = localVolume <= 0;

  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-grow flex-col gap-4 p-4">
        <div className="flex items-start gap-4">
          <div className="relative">
            <Avatar className={`h-16 w-16 transition-all ${activeMember ? 'ring-4 ring-green-400 ring-offset-2 ring-offset-background shadow-lg' : 'ring-2 ring-indigo-400/40'}`}>
              {displayMember?.photoURL ? <AvatarImage src={displayMember.photoURL} alt={displayMember.displayName} /> : null}
              <AvatarFallback className="bg-indigo-600 text-white">D</AvatarFallback>
            </Avatar>
            <span className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-background ${running ? (activeMember ? 'bg-green-500' : 'bg-indigo-500') : 'bg-slate-500'}`} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-lg font-bold">Discord Voice</p>
              <Badge variant={running ? 'secondary' : 'outline'}>{running ? 'LIVE' : 'OFF'}</Badge>
              {returnBlocked && running ? <Badge variant="destructive">Return blocked</Badge> : null}
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {activeMember ? `${activeMember.displayName} speaking` : running ? `${humanCount} ${humanCount === 1 ? 'person' : 'people'} in Discord` : 'Bridge ready'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">48 kHz mono voice · bot TTS included · music stays in Discord Activity</p>
          </div>

          <div className="flex items-center gap-1">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {canManage ? (
              <Button variant={showSettings ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setShowSettings((value) => !value)} aria-label="Discord bridge settings">
                <Settings2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>

        {members.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {members.map((member) => {
              const speaking = member.speaking || activeIds.has(member.id);
              return (
                <div key={member.id} className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${speaking ? 'border-green-500/60 bg-green-500/10 text-green-300' : 'text-muted-foreground'}`}>
                  <Avatar className="h-5 w-5">
                    {member.photoURL ? <AvatarImage src={member.photoURL} alt={member.displayName} /> : null}
                    <AvatarFallback>{member.displayName?.charAt(0)?.toUpperCase() || 'D'}</AvatarFallback>
                  </Avatar>
                  <span className="max-w-28 truncate">{member.displayName}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="mt-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={!participant}
            onClick={() => setLocalVolume((value) => value > 0 ? 0 : lastNonZeroVolume.current || 1)}
            aria-label={locallyMuted ? 'Unmute Discord for me' : 'Mute Discord for me'}
          >
            {locallyMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          <Slider
            aria-label="Discord local volume"
            value={[Math.round(localVolume * 100)]}
            onValueChange={(value) => setLocalVolume(Math.max(0, Math.min(1, value[0] / 100)))}
            max={100}
            step={1}
            disabled={!participant}
          />
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(localVolume * 100)}%</span>
        </div>

        {showSettings && canManage ? (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Server</Label>
                <Select value={guildId} onValueChange={onGuildChange} disabled={running || busy}>
                  <SelectTrigger><SelectValue placeholder="Select server" /></SelectTrigger>
                  <SelectContent>{guilds.map((guild) => <SelectItem key={guild.id} value={guild.id}>{guild.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Voice channel</Label>
                <Select value={voiceChannelId} onValueChange={setVoiceChannelId} disabled={running || busy || !guildId || loadingChannels}>
                  <SelectTrigger><SelectValue placeholder={loadingChannels ? 'Loading…' : 'Select voice channel'} /></SelectTrigger>
                  <SelectContent>{channels.map((channel) => <SelectItem key={channel.id} value={channel.id}>{channel.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border p-2.5">
              <div>
                <Label>Voice bridge</Label>
                <p className="text-xs text-muted-foreground">The bridge bot itself is never counted as a person.</p>
              </div>
              <Switch checked={running} disabled={busy} onCheckedChange={(checked) => void setBridge(checked)} />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border p-2.5">
              <div>
                <Label>Let Discord hear this room</Label>
                <p className="text-xs text-muted-foreground">Human microphones and persona TTS return to Discord. Music does not use this lane.</p>
              </div>
              <Switch checked={roomVoiceOutboundEnabled} disabled={busy} onCheckedChange={(checked) => void setRoomOutbound(checked)} />
            </div>

            <div className="space-y-1.5">
              <Label>Reliability</Label>
              <Select value={audioProfile} onValueChange={(value) => void changeAudioProfile(value as typeof audioProfile)} disabled={busy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low-latency">Low latency</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="resilient">Resilient</SelectItem>
                </SelectContent>
              </Select>
              {running && status?.discordJitter ? (
                <p className="text-xs text-muted-foreground">
                  Buffer {status.discordJitter.bufferedMs ?? 0}/{status.discordJitter.targetMs ?? 0} ms · jitter {status.discordJitter.arrivalJitterMs ?? 0} ms · underruns {status.discordJitter.underruns ?? 0} · dropped {status.discordJitter.droppedFrames ?? 0}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
