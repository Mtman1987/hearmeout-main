'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Headphones, Mic, MicOff, MoreVertical, Move, ShieldOff, Trash2, UserX, Volume2, VolumeX, LoaderCircle, LogOut, Radio, MessageSquare, Music, ListMusic, Users } from 'lucide-react';
import { useRoomContext } from '@livekit/components-react';
import * as LivekitClient from 'livekit-client';
import { useSession } from '@/hooks/use-session';
import { useDoc } from '@/hooks/use-db';
import { dbSet, dbDelete, dbUpdate } from '@/lib/db-helpers';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpeakingIndicator } from "./SpeakingIndicator";
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAudioDevice } from '@/hooks/use-audio-device';
import { useVoiceControls } from '@/hooks/use-voice-controls';
import { useRouter } from 'next/navigation';

interface RoomParticipantData { id: string; uid: string; displayName: string; photoURL: string; twitchChannel?: string; discordGuildId?: string; streamMode?: boolean; serverMuted?: boolean; }

export default function UserCard({ participant, isLocal, isHost, roomId }: { participant: LivekitClient.Participant; isLocal: boolean; isHost?: boolean; roomId: string; }) {
  const { user } = useSession();
  const { toast } = useToast();
  const room = useRoomContext();
  const router = useRouter();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [twitchDialogOpen, setTwitchDialogOpen] = React.useState(false);
  const [twitchChannel, setTwitchChannel] = React.useState('');
  const [discordDialogOpen, setDiscordDialogOpen] = React.useState(false);
  const [discordGuildId, setDiscordGuildId] = React.useState('');
  const [streamMode, setStreamMode] = React.useState(false);
  const [showOverlayControls, setShowOverlayControls] = React.useState(false);
  const { data: roomPreferences } = useDoc<{ overlayVisible?: Record<string, boolean>; overlayHiddenUsers?: string[] }>('rooms', roomId);
  const [volume, setVolume] = React.useState(1);
  const [isMutedByMe, setIsMutedByMe] = React.useState(false);
  const lastNonZeroVolume = React.useRef(volume);

  const { devices: audioInputDevices, activeDeviceId: activeAudioInputDeviceId, setDevice: setAudioInputDevice } = useAudioDevice({ kind: 'audioinput' });
  const { devices: audioOutputDevices, activeDeviceId: activeAudioOutputDeviceId, setDevice: setAudioOutputDevice } = useAudioDevice({ kind: 'audiooutput' });

  const { name, identity } = participant;
  const participantMeta = participant.metadata ? JSON.parse(participant.metadata) : {};
  const userRecordId = participantMeta.uid || identity;
  const [trackAudioLevel, setTrackAudioLevel] = useState(0);
  const isSpeaking = participant.isSpeaking;

  const setMicEnabled = useCallback(async (enabled: boolean) => {
    if (!isLocal || !room) return;
    await room.localParticipant.setMicrophoneEnabled(enabled);
  }, [isLocal, room]);

  const voiceControls = useVoiceControls({ setMicEnabled, audioLevel: trackAudioLevel });
  const [pttBinding, setPttBinding] = useState(false);

  useEffect(() => {
    if (!participant) return;
    const handleAudioLevel = (level: number) => setTrackAudioLevel(level);
    const audioTrack = participant.getTrackPublication(LivekitClient.Track.Source.Microphone);
    if (audioTrack?.audioTrack) (audioTrack.audioTrack as any).on('audioLevel', handleAudioLevel);
    return () => { const at = participant.getTrackPublication(LivekitClient.Track.Source.Microphone); if (at?.audioTrack) (at.audioTrack as any).off('audioLevel', handleAudioLevel); };
  }, [participant]);

  useEffect(() => {
    if (isLocal) return;
    if (volume > 0) { lastNonZeroVolume.current = volume; setIsMutedByMe(false); } else { setIsMutedByMe(true); }
    // Apply volume directly to the LiveKit remote participant
    const remoteParticipant = participant as LivekitClient.RemoteParticipant;
    if (typeof remoteParticipant.setVolume === 'function') remoteParticipant.setVolume(volume);
  }, [volume, isLocal, participant]);
  const toggleMuteByMe = () => { if (isLocal) return; setVolume(prev => (prev > 0 ? 0 : lastNonZeroVolume.current || 1)); };

  const { data: firestoreUser } = useDoc<RoomParticipantData>(userRecordId ? `rooms/${roomId}/users` : null, userRecordId || null);

  React.useEffect(() => {
    if (firestoreUser?.twitchChannel) setTwitchChannel(firestoreUser.twitchChannel);
    if (firestoreUser?.discordGuildId) setDiscordGuildId(firestoreUser.discordGuildId);
    if (typeof firestoreUser?.streamMode === 'boolean') setStreamMode(firestoreUser.streamMode);
  }, [firestoreUser]);

  // Auto-fill from session data (enriched from DSH) if room user doc is empty
  React.useEffect(() => {
    if (!isLocal || !userRecordId || !user) return;
    const su = user as any;
    // Auto-fill twitch channel from DSH profile if not set in room
    if (!firestoreUser?.twitchChannel && su.twitchLogin) {
      setTwitchChannel(su.twitchLogin);
      dbSet(`rooms/${roomId}/users`, userRecordId, { twitchChannel: su.twitchLogin }, true);
    }
    // Auto-fill discord guild ID from DSH profile if not set in room
    if (!firestoreUser?.discordGuildId && su.discordGuildId) {
      setDiscordGuildId(su.discordGuildId);
      dbSet(`rooms/${roomId}/users`, userRecordId, { discordGuildId: su.discordGuildId }, true);
      // Also fetch channels
      fetch(`/api/discord/channels?guildId=${su.discordGuildId}`)
        .then(r => r.ok ? r.json() : [])
        .then(channels => {
          if (Array.isArray(channels) && channels.length > 0) {
            const defaultCh = channels.find((ch: any) => ch.type === 0)?.id || channels[0]?.id;
            dbSet(`rooms/${roomId}/users`, userRecordId, { discordChannels: channels, discordSelectedChannel: defaultCh }, true);
          }
        })
        .catch(() => {});
    }
  }, [isLocal, userRecordId, user, firestoreUser, roomId]);

  React.useEffect(() => {
    const checkOverlay = () => setShowOverlayControls(localStorage.getItem('overlay-open') === 'true');
    checkOverlay();
    window.addEventListener('storage', checkOverlay);
    const interval = setInterval(checkOverlay, 1000);
    return () => { window.removeEventListener('storage', checkOverlay); clearInterval(interval); };
  }, []);

  const toggleOverlayWidget = (widget: 'chat' | 'music' | 'queue') => {
    const visible = { chat: true, music: true, queue: true, ...(roomPreferences?.overlayVisible || {}) };
    visible[widget] = !visible[widget];
    dbUpdate('rooms', roomId, { overlayVisible: visible });
  };

  const showHiddenUsers = () => {
    const hiddenUsers = roomPreferences?.overlayHiddenUsers || [];
    if (hiddenUsers.length > 0) {
      dbUpdate('rooms', roomId, { overlayHiddenUsers: [] });
      toast({ title: 'Profiles Restored', description: `${hiddenUsers.length} hidden profile(s) restored` });
    }
  };

  const handleToggleStreamMode = () => {
    if (!userRecordId) return;
    const newMode = !streamMode;
    setStreamMode(newMode);
    dbSet(`rooms/${roomId}/users`, userRecordId, { streamMode: newMode }, true);
    toast({ title: newMode ? 'Stream Mode ON' : 'Stream Mode OFF', description: newMode ? 'Media plays through the OBS overlay. Room voices stay here.' : 'Media plays normally in the room again.' });
  };

  const handleSaveTwitch = () => {
    if (!userRecordId) return;
    dbSet(`rooms/${roomId}/users`, userRecordId, { twitchChannel: twitchChannel.trim().toLowerCase() || null }, true);
    toast({ title: 'Saved', description: 'Twitch channel updated. Bot will join within 30 seconds.' });
    setTwitchDialogOpen(false);
  };

  const handleSaveDiscord = async () => {
    if (!userRecordId) return;
    const guildId = discordGuildId.trim();
    if (!guildId) {
      dbSet(`rooms/${roomId}/users`, userRecordId, { discordGuildId: null, discordChannels: null, discordSelectedChannel: null }, true);
      toast({ title: 'Cleared', description: 'Discord configuration removed.' });
      setDiscordDialogOpen(false);
      return;
    }
    try {
      const res = await fetch(`/api/discord/channels?guildId=${guildId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const channels = await res.json();
      if (!Array.isArray(channels) || channels.length === 0) throw new Error('No channels returned.');
      const defaultChannel = channels.find((ch: any) => ch.type === 0)?.id || channels[0]?.id;
      dbSet(`rooms/${roomId}/users`, userRecordId, { discordGuildId: guildId, discordChannels: channels, discordSelectedChannel: defaultChannel }, true);
      toast({ title: 'Saved', description: `Discord configured with ${channels.length} channels.` });
      setDiscordDialogOpen(false);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Discord Error', description: e.message });
    }
  };

  const handleToggleMic = async () => { if (isLocal && room) await room.localParticipant.setMicrophoneEnabled(!participant.isMicrophoneEnabled); };
  const isMuted = !participant.isMicrophoneEnabled;
  const liveKitName = name && name !== 'User' ? name : null;
  const sessionName = isLocal ? user?.displayName || (user as any)?.username : null;
  const sessionPhoto = isLocal ? user?.photoURL : null;
  const displayName = liveKitName || participantMeta.displayName || firestoreUser?.displayName || sessionName || 'User';
  const photoURL = participantMeta.photoURL || firestoreUser?.photoURL || sessionPhoto || `https://picsum.photos/seed/${userRecordId}/100/100`;
  const handleLeaveRoom = () => { room.disconnect(); router.push('/'); };

  const [moveDialogOpen, setMoveDialogOpen] = React.useState(false);
  const [availableRooms, setAvailableRooms] = React.useState<Array<{id: string; name: string}>>([]);
  const [selectedMoveRoom, setSelectedMoveRoom] = React.useState('');
  const [adminActionPending, setAdminActionPending] = React.useState(false);

  const doAdminAction = async (action: string, extra?: Record<string, string>) => {
    setAdminActionPending(true);
    try {
      const res = await fetch('/api/room-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, roomId, targetUserId: userRecordId, targetParticipantIdentity: identity, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast({ title: `${action.charAt(0).toUpperCase() + action.slice(1)}`, description: `${displayName} has been ${data.action}.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setAdminActionPending(false);
    }
  };

  const openDialogSafely = (open: () => void) => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
    open();
  };

  const handleBan = () => doAdminAction('ban');
  const handleServerMute = () => {
    const isMutedByServer = firestoreUser?.serverMuted;
    doAdminAction(isMutedByServer ? 'unmute' : 'mute');
  };
  const handleKick = () => doAdminAction('kick');
  const handleOpenMove = async () => {
    try {
      const res = await fetch(`/api/db?collection=rooms`);
      const rooms = await res.json();
      setAvailableRooms((rooms || []).filter((r: any) => r.id !== roomId).map((r: any) => ({ id: r.id, name: r.data?.name || r.id })));
    } catch { setAvailableRooms([]); }
    setMoveDialogOpen(true);
  };
  const handleMove = () => {
    if (!selectedMoveRoom) return;
    doAdminAction('move', { targetRoomId: selectedMoveRoom });
    setMoveDialogOpen(false);
    setSelectedMoveRoom('');
  };

  const handleDeleteRoom = async () => {
    if (!isHost || !roomId) return;
    setIsDeleting(true);
    try {
      await room.disconnect();
      dbDelete('rooms', roomId);
      toast({ title: "Room Deleted", description: "The room has been successfully deleted." });
      router.push('/');
    } catch { toast({ variant: 'destructive', title: 'Error', description: 'Could not delete the room.' }); }
    finally { setIsDeleting(false); }
  };

  return (
    <>
      <Card className="flex flex-col h-full">
        <CardContent className="p-4 flex flex-col gap-4 flex-grow">
            <div className="flex items-start gap-4">
                <div className="relative">
                    <Avatar className={cn("h-16 w-16 transition-all", isSpeaking && !isMuted && "ring-4 ring-primary ring-offset-2 ring-offset-card", isSpeaking && isMuted && "ring-4 ring-destructive ring-offset-2 ring-offset-card")}>
                        <AvatarImage src={photoURL} alt={displayName || 'User'} />
                        <AvatarFallback>{displayName?.charAt(0)?.toUpperCase() || 'U'}</AvatarFallback>
                    </Avatar>
                    {isMuted && <div className="absolute -bottom-1 -right-1 bg-destructive rounded-full p-1 border-2 border-card"><MicOff className="w-3 h-3 text-destructive-foreground" /></div>}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-bold text-lg truncate">{displayName}</p>
                    {isLocal ? (
                        <div className="flex items-center gap-1 text-muted-foreground">
                            <Tooltip><TooltipTrigger asChild><Button variant={isMuted ? "destructive" : "ghost"} size="icon" onClick={handleToggleMic} className="h-7 w-7">{isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent><p>{isMuted ? 'Unmute' : 'Mute'}</p></TooltipContent></Tooltip>
                            <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><Headphones className="h-4 w-4" /></Button></PopoverTrigger>
                                <PopoverContent className="w-80"><div className="grid gap-4"><div className="space-y-2"><h4 className="font-medium leading-none">Audio Settings</h4></div><div className="grid gap-2">
                                    <div className="grid grid-cols-3 items-center gap-4"><Label htmlFor="mic-select">Microphone</Label><Select value={activeAudioInputDeviceId} onValueChange={setAudioInputDevice}><SelectTrigger id="mic-select" className="col-span-2"><SelectValue placeholder="Select an input" /></SelectTrigger><SelectContent>{audioInputDevices.map(d => <SelectItem key={d.deviceId} value={d.deviceId}>{d.label}</SelectItem>)}</SelectContent></Select></div>
                                    <div className="grid grid-cols-3 items-center gap-4"><Label htmlFor="speaker-select">Speakers</Label><Select value={activeAudioOutputDeviceId} onValueChange={setAudioOutputDevice}><SelectTrigger id="speaker-select" className="col-span-2"><SelectValue placeholder="Select an output" /></SelectTrigger><SelectContent>{audioOutputDevices.map(d => <SelectItem key={d.deviceId} value={d.deviceId}>{d.label}</SelectItem>)}</SelectContent></Select></div>
                                    <div className="border-t pt-2 mt-1">
                                      <Label className="text-xs text-muted-foreground">Voice Mode</Label>
                                      <div className="flex gap-1 mt-1">
                                        <Button variant={voiceControls.mode === 'open' ? 'secondary' : 'outline'} size="sm" className="flex-1 text-xs" onClick={() => voiceControls.setMode('open')}>Open</Button>
                                        <Button variant={voiceControls.mode === 'pushToTalk' ? 'secondary' : 'outline'} size="sm" className="flex-1 text-xs" onClick={() => voiceControls.setMode('pushToTalk')}>PTT</Button>
                                        <Button variant={voiceControls.mode === 'noiseGate' ? 'secondary' : 'outline'} size="sm" className="flex-1 text-xs" onClick={() => voiceControls.setMode('noiseGate')}>Gate</Button>
                                      </div>
                                    </div>
                                    {voiceControls.mode === 'pushToTalk' && (
                                      <div className="border-t pt-2">
                                        <Label className="text-xs text-muted-foreground">PTT Key</Label>
                                        <div className="flex gap-2 mt-1 items-center">
                                          <Button variant="outline" size="sm" className={cn('flex-1 text-xs', pttBinding && 'ring-2 ring-primary')} onClick={() => setPttBinding(true)} onKeyDown={(e) => { if (pttBinding) { e.preventDefault(); voiceControls.setPttKey(e.key === ' ' ? ' ' : e.code || e.key); setPttBinding(false); } }} onMouseDown={(e) => { if (pttBinding && e.button !== 0) { e.preventDefault(); voiceControls.setPttKey(`Mouse${e.button}`); setPttBinding(false); } }} onBlur={() => setPttBinding(false)}>
                                            {pttBinding ? 'Press a key...' : voiceControls.pttKey === ' ' ? 'Space' : voiceControls.pttKey}
                                          </Button>
                                          {voiceControls.isPttActive && <span className="text-xs text-green-500 font-medium">● Active</span>}
                                        </div>
                                      </div>
                                    )}
                                    {voiceControls.mode === 'noiseGate' && (
                                      <div className="border-t pt-2 space-y-2">
                                        <div>
                                          <Label className="text-xs text-muted-foreground">Threshold: {Math.round(voiceControls.noiseGateThreshold * 1000)}‰</Label>
                                          <Slider value={[voiceControls.noiseGateThreshold]} onValueChange={(v) => voiceControls.setNoiseGateThreshold(v[0])} min={0.005} max={0.1} step={0.005} className="mt-1" />
                                        </div>
                                        <div>
                                          <Label className="text-xs text-muted-foreground">Release: {voiceControls.noiseGateRelease}ms</Label>
                                          <Slider value={[voiceControls.noiseGateRelease]} onValueChange={(v) => voiceControls.setNoiseGateRelease(v[0])} min={50} max={1000} step={50} className="mt-1" />
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <div className={cn('h-2 w-2 rounded-full', voiceControls.isGateOpen ? 'bg-green-500' : 'bg-red-500')} />
                                          <span className="text-xs text-muted-foreground">{voiceControls.isGateOpen ? 'Gate Open' : 'Gate Closed'}</span>
                                          <span className="text-xs text-muted-foreground ml-auto">Level: {Math.round(trackAudioLevel * 100)}%</span>
                                        </div>
                                      </div>
                                    )}
                                </div></div></PopoverContent>
                            </Popover>
                            <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                    <DropdownMenuItem onClick={handleToggleStreamMode}><Radio className="mr-2 h-4 w-4" /><span>{streamMode ? '✓ Stream Mode' : 'Stream Mode'}</span></DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onSelect={() => openDialogSafely(() => setTwitchDialogOpen(true))}><Radio className="mr-2 h-4 w-4" /><span>Twitch Bot</span></DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => openDialogSafely(() => setDiscordDialogOpen(true))}><MessageSquare className="mr-2 h-4 w-4" /><span>Discord Bot</span></DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={handleLeaveRoom}><LogOut className="mr-2 h-4 w-4" /><span>Leave Room</span></DropdownMenuItem>
                                    {isHost && (<><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => openDialogSafely(() => setIsDeleteDialogOpen(true))} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" /><span>Delete Room</span></DropdownMenuItem></>)}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    ) : showOverlayControls ? (
                        <div className='flex items-center gap-1'>
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleOverlayWidget('chat')}><MessageSquare className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent><p>Toggle Chat</p></TooltipContent></Tooltip>
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleOverlayWidget('music')}><Music className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent><p>Toggle Music</p></TooltipContent></Tooltip>
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleOverlayWidget('queue')}><ListMusic className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent><p>Toggle Queue</p></TooltipContent></Tooltip>
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" onClick={showHiddenUsers}><Users className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent><p>Show Hidden Profiles</p></TooltipContent></Tooltip>
                        </div>
                    ) : isHost ? (
                        <div className='flex items-center gap-1'>
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleBan} disabled={adminActionPending}><ShieldOff className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent><p>Ban</p></TooltipContent></Tooltip>
                            <Tooltip><TooltipTrigger asChild><Button variant={firestoreUser?.serverMuted ? 'destructive' : 'ghost'} size="icon" className="h-7 w-7" onClick={handleServerMute} disabled={adminActionPending}><MicOff className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent><p>{firestoreUser?.serverMuted ? 'Unmute' : 'Server Mute'}</p></TooltipContent></Tooltip>
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDialogSafely(handleOpenMove)} disabled={adminActionPending}><Move className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent><p>Move to Room</p></TooltipContent></Tooltip>
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleKick} disabled={adminActionPending}><UserX className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent><p>Kick</p></TooltipContent></Tooltip>
                        </div>
                    ) : null}
                </div>
            </div>
            <div className="space-y-2 flex-grow flex flex-col justify-end">
                <SpeakingIndicator audioLevel={isMuted ? 0 : (isSpeaking ? trackAudioLevel : 0)} />
                {!isLocal && (
                    <div className="flex items-center gap-2">
                        <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-8 w-8" onClick={toggleMuteByMe}>{isMutedByMe ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent><p>{isMutedByMe ? 'Unmute' : 'Mute for me'}</p></TooltipContent></Tooltip>
                        <Slider aria-label="Participant Volume" value={[volume]} onValueChange={(value) => setVolume(value[0])} max={1} step={0.05} />
                    </div>
                )}
            </div>
        </CardContent>
      </Card>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteRoom} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">{isDeleting ? <LoaderCircle className="animate-spin" /> : "Delete"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>

      <Dialog open={twitchDialogOpen} onOpenChange={setTwitchDialogOpen}>
        <DialogContent><DialogHeader><DialogTitle>Twitch Bot for {displayName}</DialogTitle><DialogDescription>Set your Twitch channel to enable bot commands</DialogDescription></DialogHeader>
        <div className="space-y-4 py-4"><div className="space-y-2"><Label htmlFor="channel">Twitch Channel Name</Label><Input id="channel" placeholder="your_channel_name" value={twitchChannel} onChange={(e) => setTwitchChannel(e.target.value)} /><p className="text-xs text-muted-foreground">Bot will respond to !sr, !np, !status in your channel</p></div></div>
        <DialogFooter><Button onClick={handleSaveTwitch}>Save</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent><DialogHeader><DialogTitle>Move {displayName} to another room</DialogTitle><DialogDescription>Select a room to move this user into. They'll be disconnected from this room and redirected.</DialogDescription></DialogHeader>
        <div className="space-y-4 py-4">
          {availableRooms.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other rooms available.</p>
          ) : (
            <div className="space-y-2">
              <Label>Target Room</Label>
              <Select value={selectedMoveRoom} onValueChange={setSelectedMoveRoom}>
                <SelectTrigger><SelectValue placeholder="Select a room" /></SelectTrigger>
                <SelectContent>{availableRooms.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter><Button onClick={handleMove} disabled={!selectedMoveRoom || adminActionPending}>Move</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={discordDialogOpen} onOpenChange={setDiscordDialogOpen}>
        <DialogContent><DialogHeader><DialogTitle>Discord Server for {displayName}</DialogTitle><DialogDescription>Set your Discord server ID to enable chat and bot controls</DialogDescription></DialogHeader>
        <div className="space-y-4 py-4"><div className="space-y-2"><Label htmlFor="guildId">Discord Server ID</Label><Input id="guildId" placeholder="123456789012345678" value={discordGuildId} onChange={(e) => setDiscordGuildId(e.target.value)} /><p className="text-xs text-muted-foreground">Enable Developer Mode in Discord, right-click your server → Copy Server ID.</p></div></div>
        <DialogFooter><Button onClick={handleSaveDiscord}>Save</Button></DialogFooter></DialogContent>
      </Dialog>
    </>
  );
}
