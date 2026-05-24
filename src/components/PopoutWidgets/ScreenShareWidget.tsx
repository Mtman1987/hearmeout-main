'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DraggableContainer } from './DraggableContainer';
import { Button } from '@/components/ui/button';
import { Monitor, Camera, StopCircle, Users } from 'lucide-react';
import { PeerScreenShare, PeerScreenViewer, ShareSource } from '@/lib/peer-audio-service';
import { useSession } from '@/hooks/use-session';

interface ScreenShareWidgetProps {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  opacity?: number;
  onPositionChange: (pos: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onOpacityChange?: (opacity: number) => void;
  onSaveLayout?: () => void;
  onClose: () => void;
  roomId: string;
}

export function ScreenShareWidget({
  id, position, size, opacity,
  onPositionChange, onSizeChange, onOpacityChange, onSaveLayout, onClose, roomId,
}: ScreenShareWidgetProps) {
  const { user } = useSession();
  const [sharing, setSharing] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [availableShares, setAvailableShares] = useState<string[]>([]);
  const broadcasterRef = useRef<PeerScreenShare | null>(null);
  const viewerRef = useRef<PeerScreenViewer | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  // Poll for active screen shares in this room
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/peer-voice/peers?roomId=${encodeURIComponent(`screen-${roomId}`)}`);
        if (res.ok) {
          const { peers } = await res.json();
          // Filter out our own share
          const myPeerId = broadcasterRef.current?.peerId;
          setAvailableShares((peers as string[]).filter(p => p !== myPeerId));
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [roomId]);

  const startShare = useCallback(async (source: ShareSource) => {
    if (!user) return;
    try {
      const broadcaster = new PeerScreenShare();
      const stream = await broadcaster.start(roomId, user.uid, source);
      broadcasterRef.current = broadcaster;
      setLocalStream(stream);
      setSharing(true);
    } catch (err) {
      console.warn('[ScreenShare] Failed to start:', err);
    }
  }, [roomId, user]);

  const stopShare = useCallback(() => {
    broadcasterRef.current?.stop();
    broadcasterRef.current = null;
    setSharing(false);
    setLocalStream(null);
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    const handleStop = (event: Event) => {
      const detail = (event as CustomEvent<{ roomId?: string }>).detail;
      if (!detail?.roomId || detail.roomId === roomId) stopShare();
    };
    window.addEventListener('hmo-stop-screen-share', handleStop);
    return () => window.removeEventListener('hmo-stop-screen-share', handleStop);
  }, [roomId, stopShare]);

  const viewShare = useCallback(async (peerId: string) => {
    // Disconnect existing viewer
    viewerRef.current?.disconnect();
    viewerRef.current = null;
    setViewing(null);

    try {
      const viewer = new PeerScreenViewer();
      await viewer.connect(
        peerId,
        (stream) => {
          setRemoteStream(stream);
        },
        () => {
          setViewing(null);
          setRemoteStream(null);
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
        },
      );
      viewerRef.current = viewer;
      setViewing(peerId);
    } catch (err) {
      console.warn('[ScreenShare] Failed to view:', err);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      broadcasterRef.current?.stop();
      viewerRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, sharing]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, viewing]);

  return (
    <DraggableContainer
      id={id}
      position={position}
      size={size}
      opacity={opacity}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onOpacityChange={onOpacityChange}
      onSaveLayout={onSaveLayout}
      onClose={onClose}
      title="Screen Share"
      minimalChrome
    >
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Video display */}
        {(sharing || viewing) && (
          <div className="aspect-video w-full rounded-md overflow-hidden border border-border bg-black relative">
            {/* Local share preview */}
            <video
              ref={localVideoRef}
              className={sharing && !viewing ? 'w-full h-full object-contain' : 'hidden'}
              autoPlay
              muted
              playsInline
            />
            {/* Remote share view */}
            <video
              ref={remoteVideoRef}
              className={viewing ? 'w-full h-full object-contain' : 'hidden'}
              autoPlay
              playsInline
            />
          </div>
        )}

        {!sharing && !viewing && (
          <div className="aspect-video w-full rounded-md border border-dashed border-border flex items-center justify-center text-muted-foreground text-sm">
            <Monitor className="h-5 w-5 mr-2" /> No active share
          </div>
        )}

        {/* Share controls */}
        {!sharing ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => startShare('screen')}>
              <Monitor className="h-3.5 w-3.5 mr-1" /> Screen
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => startShare('window')}>
              <Monitor className="h-3.5 w-3.5 mr-1" /> Window
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => startShare('camera')}>
              <Camera className="h-3.5 w-3.5 mr-1" /> Camera
            </Button>
          </div>
        ) : (
          <Button variant="destructive" size="sm" className="w-full" onClick={stopShare}>
            <StopCircle className="h-3.5 w-3.5 mr-1" /> Stop Sharing
          </Button>
        )}

        {/* Available shares from others */}
        {availableShares.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-1">
              <Users className="h-3 w-3" /> Active Shares
            </p>
            {availableShares.map((peerId) => {
              // Extract username from peer ID: hmo-screen-{roomId}-{userId}
              const parts = peerId.replace('hmo-screen-', '').split('-');
              const label = parts.slice(1).join('-') || peerId;
              return (
                <Button
                  key={peerId}
                  variant={viewing === peerId ? 'secondary' : 'outline'}
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => viewing === peerId ? (() => { viewerRef.current?.disconnect(); setViewing(null); })() : viewShare(peerId)}
                >
                  <Monitor className="h-3 w-3 mr-1" />
                  {viewing === peerId ? 'Stop Viewing' : `View: ${label}`}
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </DraggableContainer>
  );
}
