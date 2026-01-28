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
} from 'lucide-react';
import { useTracks, AudioTrack, useRoomContext } from '@livekit/components-react';
import * as LivekitClient from 'livekit-client';
import { doc, deleteDoc } from 'firebase/firestore';

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

  // Remote participant volume control state
  const [volume, setVolume] = React.useState(1);
  const [isMutedByMe, setIsMutedByMe] = React.useState(false);
  const lastNonZeroVolume = React.useRef(volume);

  const { devices: audioInputDevices, activeDeviceId: activeAudioInputDeviceId, setDevice: setAudioInputDevice } = useAudioDevice({ kind: 'audioinput' });
  const { devices: audioOutputDevices, activeDeviceId: activeAudioOutputDeviceId, setDevice: setAudioOutputDevice } = useAudioDevice({ kind: 'audiooutput' });

  const audioTracks = useTracks([LivekitClient.Track.Source.Microphone])[0];
  const audioTrackRef = audioTracks?.source === LivekitClient.Track.Source.Microphone ? audioTracks : undefined;
  
  const { name, identity } = participant;

  const [trackAudioLevel, setTrackAudioLevel] = useState(0);
  const isSpeaking = participant.isSpeaking;

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
  
  const handleToggleMic = async () => {
    if (isLocal) {
        // For local participant, use the audio track from useTracks hook
        if (audioTrackRef?.publication?.track) {
          if (participant.isMicrophoneEnabled) {
            audioTrackRef.publication.track.stop();
          }
        }
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
      {!isLocal && audioTrackRef && (
        <AudioTrack key={audioTrackRef.publication.trackSid} trackRef={audioTrackRef} volume={volume} />
      )}

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
                <SpeakingIndicator audioLevel={isMuted ? 0 : trackAudioLevel} />
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
    </>
  );
}
