'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';

type MediaDeviceKind = 'audioinput' | 'audiooutput' | 'videoinput';

type UseAudioDeviceProps = {
  kind: 'audioinput' | 'audiooutput';
};

export function useAudioDevice({ kind }: UseAudioDeviceProps) {
  const room = useRoomContext();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string>('');

  const getDevices = useCallback(async () => {
    try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const filteredDevices = allDevices.filter((d) => d.kind === kind);
        setDevices(filteredDevices);

        // Set initial active device
        if (kind === 'audioinput') {
          const activeDevice = room.getActiveDevice('audioinput');
          if (activeDevice) setActiveDeviceId(activeDevice);
        } else if (kind === 'audiooutput') {
          // For output, we default to the system default. The actual device is
          // managed by the audio elements themselves via `setSinkId`.
          setActiveDeviceId('default');
        }
    } catch (e) {
        console.error("Failed to enumerate devices:", e);
    }
  }, [kind, room]);

  useEffect(() => {
    getDevices();

    const handleDeviceChange = (changedKind: MediaDeviceKind, deviceId: string) => {
        if(changedKind === kind) {
            setActiveDeviceId(deviceId);
        }
    }

    room.on(RoomEvent.ActiveDeviceChanged, handleDeviceChange);
    // Listen for OS-level device changes
    navigator.mediaDevices.addEventListener('devicechange', getDevices);

    return () => {
      room.off(RoomEvent.ActiveDeviceChanged, handleDeviceChange);
      navigator.mediaDevices.removeEventListener('devicechange', getDevices);
    };
  }, [getDevices, room, kind]);

  const setDevice = useCallback(async (deviceId: string) => {
    if (kind === 'audioinput') {
      await room.switchActiveDevice(kind, deviceId);
      setActiveDeviceId(deviceId);
    } else if (kind === 'audiooutput') {
      // Set audio output device for HTML audio elements
      try {
        const audioElements = document.querySelectorAll('audio');
        for (const element of audioElements) {
          // Use setSinkId for audio output (browser API)
          if ('setSinkId' in element && typeof element.setSinkId === 'function') {
            await (element as any).setSinkId(deviceId);
          }
        }
        setActiveDeviceId(deviceId);
      } catch (error) {
        console.error('Error setting audio output device:', error);
      }
    }
  }, [kind, room]);

  return { devices, activeDeviceId, setDevice };
}
