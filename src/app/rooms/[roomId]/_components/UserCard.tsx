'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Headphones,
  Mic,
  MicOff,
  MoreVertical,
  Move,
  Pen,
  ShieldOff,
  Trash2,
  UserX,
  Volume2,
  VolumeX,
  LoaderCircle,
  LogOut,
  Radio,
  MessageSquare,
  Music,
  ListMusic,
  Users,
} from 'lucide-react';
import { useTracks, AudioTrack, useRoomContext } from '@livekit/components-react';
import * as LivekitClient from 'livekit-client';
import { doc, deleteDoc, updateDoc, setDoc } from 'firebase/firestore';

import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpeakingIndicator } from "./SpeakingIndicator";
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAudioDevice } from '@/hooks/use-audio-device';
import { useRouter } from 'next/navigation';


interface RoomParticipantData {
  id: string;
  uid: string;
  displayName: string;
  photoURL: string;
  twitchChannel?: string;
  discordGuildId?: string;
}

export default function UserCard({
    participant,
    isLocal,
    isHost,
    roomId,
}: {
    participant: LivekitClient.Participant;
    isLocal: boolean;
    isHost?: boolean;
    roomId: string;
}) {
  const { firestore } = useFirebase();
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

  // Remote participant volume control state
  const [volume, setVolume] = React.useState(1);
  const [isMutedByMe, setIsMutedByMe] = React.useState(false);
  const lastNonZeroVolume = React.useRef(volume);

  const { devices: audioInputDevices, activeDeviceId: activeAudioInputDeviceId, setDevice: setAudioInputDevice } = useAudioDevice({ kind: 'audioinput' });
  const { devices: audioOutputDevices, activeDeviceId: activeAudioOutputDeviceId, setDevice: setAudioOutputDevice } = useAudioDevice({ kind: 'audiooutput' });

  // Get ALL audio tracks for this participant (microphone + music)
  const allAudioTracks = useTracks(
    [LivekitClient.Track.Source.Microphone, LivekitClient.Track.Source.Unknown],
    { onlySubscribed: true, participant }
  ).filter(track => track.participant.identity === participant.identity && track.publication);
  
  const { name, identity } = participant;

  const [trackAudioLevel, setTrackAudioLevel] = useState(0);
  const isSpeaking = participant.isSpeaking;

  // Track audio level from participant
  useEffect(() => {
    if (!participant) return;

    const handleAudioLevel = (level: number) => {
      setTrackAudioLevel(level);
    };

    participant.on('audioTrackPublished', () => {
      const audioTrack = participant.getTrackPublication(LivekitClient.Track.Source.Microphone);
      if (audioTrack?.audioTrack) {
        audioTrack.audioTrack.on('audioLevel', handleAudioLevel);
      }
    });

    // Check if track already exists
    const audioTrack = participant.getTrackPublication(LivekitClient.Track.Source.Microphone);
    if (audioTrack?.audioTrack) {
      audioTrack.audioTrack.on('audioLevel', handleAudioLevel);
    }

    return () => {
      const audioTrack = participant.getTrackPublication(LivekitClient.Track.Source.Microphone);
      if (audioTrack?.audioTrack) {
        audioTrack.audioTrack.off('audioLevel', handleAudioLevel);
      }
    };
  }, [participant]);

  useEffect(() => {
    if (isLocal) return;
    if (volume > 0) {
        lastNonZeroVolume.current = volume;
        setIsMutedByMe(false);
    } else {
        setIsMutedByMe(true);
    }
  }, [volume, isLocal]);
  
  const toggleMuteByMe = () => {
    if (isLocal) return;
    setVolume(prevVolume => (prevVolume > 0 ? 0 : lastNonZeroVolume.current || 1));
  };

  const userInRoomRef = useMemoFirebase(() => {
    if (!firestore || !roomId || !identity) return null;
    return doc(firestore, 'rooms', roomId, 'users', identity);
  }, [firestore, roomId, identity]);

  const { data: firestoreUser } = useDoc<RoomParticipantData>(userInRoomRef);

  React.useEffect(() => {
    if (firestoreUser?.twitchChannel) {
      setTwitchChannel(firestoreUser.twitchChannel);
    }
    if (firestoreUser?.discordGuildId) {
      setDiscordGuildId(firestoreUser.discordGuildId);
    }
    if (typeof firestoreUser?.streamMode === 'boolean') {
      setStreamMode(firestoreUser.streamMode);
    }
  }, [firestoreUser]);

  React.useEffect(() => {
    const checkOverlay = () => {
      const overlayOpen = localStorage.getItem('overlay-open') === 'true';
      setShowOverlayControls(overlayOpen);
    };
    checkOverlay();
    window.addEventListener('storage', checkOverlay);
    const interval = setInterval(checkOverlay, 1000);
    return () => {
      window.removeEventListener('storage', checkOverlay);
      clearInterval(interval);
    };
  }, []);

  const toggleOverlayWidget = (widget: string) => {
    const saved = localStorage.getItem('overlay-visible');
    const visible = saved ? JSON.parse(saved) : { chat: true, music: true, queue: true };
    visible[widget] = !visible[widget];
    localStorage.setItem('overlay-visible', JSON.stringify(visible));
    window.dispatchEvent(new Event('storage'));
  };

  const showHiddenUsers = () => {
    const savedUsers = localStorage.getItem('overlay-hidden-users');
    const hiddenUsers = savedUsers ? JSON.parse(savedUsers) : [];
    if (hiddenUsers.length > 0) {
      localStorage.setItem('overlay-hidden-users', JSON.stringify([]));
      window.dispatchEvent(new Event('storage'));
      toast({ title: 'Profiles Restored', description: `${hiddenUsers.length} hidden profile(s) restored` });
    }
  };

  const handleToggleStreamMode = async () => {
    if (!userInRoomRef) return;
    const newMode = !streamMode;
    setStreamMode(newMode);
    try {
      await setDoc(userInRoomRef, { streamMode: newMode }, { merge: true });
      toast({ 
        title: newMode ? 'Stream Mode ON' : 'Stream Mode OFF', 
        description: newMode 
          ? 'Main page audio disabled. Use overlay in OBS for all audio.' 
          : 'Main page audio enabled. Overlay audio disabled.'
      });
    } catch (e) {
      console.error('[UserCard] Stream mode toggle error:', e);
      setStreamMode(!newMode);
    }
  };

  const handleSaveTwitch = async () => {
    if (!userInRoomRef) {
      toast({ variant: 'destructive', title: 'Error', description: 'User reference not available. Try refreshing.' });
      return;
    }
    try {
      const channelValue = twitchChannel.trim().toLowerCase();
      console.log('[UserCard] Saving Twitch channel:', channelValue);
      await setDoc(userInRoomRef, { twitchChannel: channelValue || null }, { merge: true });
      toast({ title: 'Saved', description: 'Twitch channel updated. Bot will join within 30 seconds.' });
      setTwitchDialogOpen(false);
    } catch (e) {
      console.error('[UserCard] Twitch save error:', e);
      toast({ variant: 'destructive', title: 'Error', description: `Failed to update: ${e instanceof Error ? e.message : 'Unknown error'}` });
    }
  };

  const handleSaveDiscord = async () => {
    if (!userInRoomRef) {
      toast({ variant: 'destructive', title: 'Error', description: 'User reference not available. Try refreshing.' });
      return;
    }
    
    const guildId = discordGuildId.trim();
    
    if (!guildId) {
      try {
        await setDoc(userInRoomRef, { 
          discordGuildId: null,
          discordChannels: null,
          discordSelectedChannel: null
        }, { merge: true });
        toast({ title: 'Cleared', description: 'Discord configuration removed.' });
        setDiscordDialogOpen(false);
      } catch (e) {
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to clear Discord data.' });
      }
      return;
    }
    
    try {
      console.log('[UserCard] Fetching channels for guild:', guildId);
      
      const res = await fetch(`/api/discord/channels?guildId=${guildId}`);
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[UserCard] Discord API error:', res.status, errorData);
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
      
      const channels = await res.json();
      
      if (!Array.isArray(channels) || channels.length === 0) {
        throw new Error('No channels returned. Verify bot is in server.');
      }
      
      const firstTextChannel = channels.find((ch: any) => ch.type === 0);
      const defaultChannel = firstTextChannel?.id || channels[0]?.id;
      
      await setDoc(userInRoomRef, { 
        discordGuildId: guildId,
        discordChannels: channels,
        discordSelectedChannel: defaultChannel
      }, { merge: true });
      
      toast({ title: 'Saved', description: `Discord configured with ${channels.length} channels.` });
      setDiscordDialogOpen(false);
    } catch (e) {
      console.error('[UserCard] Discord save error:', e);
      const errorMsg = e instanceof Error ? e.message : 'Unknown error';
      toast({ 
        variant: 'destructive', 
        title: 'Discord Error', 
        description: errorMsg
      });
    }
  };
  
  const handleToggleMic = async () => {
    if (isLocal && room) {
      const enabled = participant.isMicrophoneEnabled;
      await room.localParticipant.setMicrophoneEnabled(!enabled);
    }
  };
  
  const isMuted = !participant.isMicrophoneEnabled;
  
  const participantMeta = participant.metadata ? JSON.parse(participant.metadata) : {};
  const displayName = name || participantMeta.displayName || firestoreUser?.displayName || 'User';
  const photoURL = participantMeta.photoURL || firestoreUser?.photoURL || `https://picsum.photos/seed/${identity}/100/100`;
  
  const handleLeaveRoom = () => {
    room.disconnect();
    router.push('/');
  };

  const handleDeleteRoom = async () => {
    if (!isHost || !firestore || !roomId) {
        toast({ variant: "destructive", title: "Error", description: "You do not have permission to delete this room." });
        return;
    };
    setIsDeleting(true);
    try {
        await room.disconnect();
        const roomRef = doc(firestore, 'rooms', roomId);
        await deleteDoc(roomRef);
        toast({ title: "Room Deleted", description: "The room has been successfully deleted." });
        router.push('/');
    } catch (error) {
        console.error("Error deleting room:", error);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not delete the room.' });
        setIsDeleting(false);
    } finally {
        setIsDeleting(false);
    }
  };


  return (
    <>
      <Card className="flex flex-col h-full">
        <CardContent className="p-4 flex flex-col gap-4 flex-grow">
            <div className="flex items-start gap-4">
                <div className="relative">
                    <Avatar className={cn("h-16 w-16 transition-all", isSpeaking && "ring-4 ring-primary ring-offset-2 ring-offset-card")}>
                       <>
                        <AvatarImage src={photoURL} alt={displayName || 'User'} data-ai-hint="person portrait" />
                        <AvatarFallback>{displayName?.charAt(0)?.toUpperCase() || 'U'}</AvatarFallback>
                       </>
                    </Avatar>
                     {isMuted && (
                        <div className="absolute -bottom-1 -right-1 bg-destructive rounded-full p-1 border-2 border-card">
                            <MicOff className="w-3 h-3 text-destructive-foreground" />
                        </div>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-bold text-lg truncate">{displayName}</p>
                    {isLocal ? (
                         <div className="flex items-center gap-1 text-muted-foreground">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                     <Button variant={isMuted ? "destructive" : "ghost"} size="icon" onClick={handleToggleMic} className="h-7 w-7" disabled={!isLocal}>
                                        {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>{isMuted ? 'Unmute' : 'Mute'}</p></TooltipContent>
                            </Tooltip>

                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7">
                                        <Headphones className="h-4 w-4" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80">
                                    <div className="grid gap-4">
                                        <div className="space-y-2">
                                            <h4 className="font-medium leading-none">Audio Settings</h4>
                                            <p className="text-sm text-muted-foreground">
                                                Manage your input and output devices.
                                            </p>
                                        </div>
                                        <div className="grid gap-2">
                                            <div className="grid grid-cols-3 items-center gap-4">
                                                <Label htmlFor="mic-select">Microphone</Label>
                                                <Select value={activeAudioInputDeviceId} onValueChange={setAudioInputDevice}>
                                                    <SelectTrigger id="mic-select" className="col-span-2">
                                                        <SelectValue placeholder="Select an input" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {audioInputDevices.map((device) => (
                                                            <SelectItem key={device.deviceId} value={device.deviceId}>{device.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                             <div className="grid grid-cols-3 items-center gap-4">
                                                <Label htmlFor="speaker-select">Speakers</Label>
                                                <Select value={activeAudioOutputDeviceId} onValueChange={setAudioOutputDevice}>
                                                    <SelectTrigger id="speaker-select" className="col-span-2">
                                                        <SelectValue placeholder="Select an output" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {audioOutputDevices.map((device) => (
                                                            <SelectItem key={device.deviceId} value={device.deviceId}>{device.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </div>
                                </PopoverContent>
                            </Popover>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                    <DropdownMenuItem onClick={handleToggleStreamMode}>
                                        <Radio className="mr-2 h-4 w-4" />
                                        <span>{streamMode ? '✓ Stream Mode' : 'Stream Mode'}</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => setTwitchDialogOpen(true)}>
                                        <Radio className="mr-2 h-4 w-4" />
                                        <span>Twitch Bot</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setDiscordDialogOpen(true)}>
                                        <svg className="mr-2 h-4 w-4" role="img" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M16.29 5.23a10.08 10.08 0 0 0-2.2-.62.84.84 0 0 0-1 .75c.18.25.36.5.52.75a8.62 8.62 0 0 0-4.14 0c.16-.25.34-.5.52-.75a.84.84 0 0 0-1-.75 10.08 10.08 0 0 0-2.2.62.81.81 0 0 0-.54.78c-.28 3.24.78 6.28 2.82 8.25a.85.85 0 0 0 .93.12 7.55 7.55 0 0 0 1.45-.87.82.82 0 0 1 .9-.06 6.53 6.53 0 0 0 2.22 0 .82.82 0 0 1 .9.06 7.55 7.55 0 0 0 1.45.87.85.85 0 0 0 .93-.12c2.04-1.97 3.1-5 2.82-8.25a.81.81 0 0 0-.55-.78zM10 11.85a1.45 1.45 0 0 1-1.45-1.45A1.45 1.45 0 0 1 10 8.95a1.45 1.45 0 0 1 1.45 1.45A1.45 1.45 0 0 1 10 11.85zm4 0a1.45 1.45 0 0 1-1.45-1.45A1.45 1.45 0 0 1 14 8.95a1.45 1.45 0 0 1 1.45 1.45A1.45 1.45 0 0 1 14 11.85z"/>
                                        </svg>
                                        <span>Discord Bot</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={handleLeaveRoom}>
                                        <LogOut className="mr-2 h-4 w-4" />
                                        <span>Leave Room</span>
                                    </DropdownMenuItem>
                                    {isHost && (
                                        <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem disabled>
                                                <Pen className="mr-2 h-4 w-4" />
                                                <span>Rename Room</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => setIsDeleteDialogOpen(true)} className="text-destructive focus:text-destructive">
                                                <Trash2 className="mr-2 h-4 w-4" />
                                                <span>Delete Room</span>
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                         </div>
                    ): showOverlayControls ? (
                        <div className='flex items-center gap-1'>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleOverlayWidget('chat')}>
                                        <MessageSquare className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Toggle Chat</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleOverlayWidget('music')}>
                                        <Music className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Toggle Music</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleOverlayWidget('queue')}>
                                        <ListMusic className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Toggle Queue</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={showHiddenUsers}>
                                        <Users className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Show Hidden Profiles</p></TooltipContent>
                            </Tooltip>
                        </div>
                    ): (
                        isHost && (
                           <div className='flex items-center gap-1'>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7"><UserX className="h-4 w-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Kick</p></TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled><ShieldOff className="h-4 w-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Ban</p></TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled><MicOff className="h-4 w-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Mute for Room</p></TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled><Move className="h-4 w-4" /></Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Move to Room</p></TooltipContent>
                                </Tooltip>
                            </div>
                        )
                    )}
                </div>
            </div>
          
            <div className="space-y-2 flex-grow flex flex-col justify-end">
                <SpeakingIndicator audioLevel={isMuted ? 0 : (isSpeaking ? trackAudioLevel : 0)} />
                 {!isLocal && (
                     <div className="flex items-center gap-2">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={toggleMuteByMe}
                                >
                                    {isMutedByMe ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>{isMutedByMe ? 'Unmute' : 'Mute for me'}</p></TooltipContent>
                        </Tooltip>
                        <Slider
                            aria-label="Participant Volume"
                            value={[volume]}
                            onValueChange={(value) => setVolume(value[0])}
                            max={1}
                            step={0.05}
                        />
                    </div>
                )}
            </div>
        </CardContent>
      </Card>
      
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete this room and all of its associated data.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteRoom} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                    {isDeleting ? <LoaderCircle className="animate-spin" /> : "Delete"}
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={twitchDialogOpen} onOpenChange={setTwitchDialogOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Twitch Bot for {displayName}</DialogTitle>
                <DialogDescription>Set your Twitch channel to enable bot commands in this room</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="channel">Twitch Channel Name</Label>
                    <Input
                        id="channel"
                        placeholder="your_channel_name"
                        value={twitchChannel}
                        onChange={(e) => setTwitchChannel(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Bot will respond to !sr, !np, !status in your channel</p>
                </div>
            </div>
            <DialogFooter>
                <Button onClick={handleSaveTwitch}>Save</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discordDialogOpen} onOpenChange={setDiscordDialogOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Discord Server for {displayName}</DialogTitle>
                <DialogDescription>Set your Discord server ID to enable chat and bot controls</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="guildId">Discord Server ID</Label>
                    <Input
                        id="guildId"
                        placeholder="123456789012345678"
                        value={discordGuildId}
                        onChange={(e) => setDiscordGuildId(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Enable Developer Mode in Discord, right-click your server → Copy Server ID. Use the channel dropdown in chat to select channels.</p>
                </div>
            </div>
            <DialogFooter>
                <Button onClick={handleSaveDiscord}>Save</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
