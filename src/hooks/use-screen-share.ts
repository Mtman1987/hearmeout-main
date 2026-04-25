import { useEffect, useState, useCallback } from 'react';

export interface ScreenShareState {
  isSharing: boolean;
  stream: MediaStream | null;
  error: string | null;
  isSupported: boolean;
}

export function useScreenShare() {
  const [state, setState] = useState<ScreenShareState>({
    isSharing: false,
    stream: null,
    error: null,
    isSupported: typeof navigator !== 'undefined' && 'mediaDevices' in navigator && 'getDisplayMedia' in navigator.mediaDevices
  });

  const startScreenShare = useCallback(async () => {
    if (!state.isSupported) {
      setState(prev => ({ ...prev, error: 'Screen sharing not supported' }));
      return;
    }

    try {
      setState(prev => ({ ...prev, error: null }));
      
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000
        }
      });

      // Handle stream end (user clicks "Stop sharing" in browser)
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopScreenShare();
      });

      setState(prev => ({
        ...prev,
        isSharing: true,
        stream,
        error: null
      }));

      return stream;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start screen sharing';
      setState(prev => ({
        ...prev,
        error: errorMessage,
        isSharing: false,
        stream: null
      }));
      throw error;
    }
  }, [state.isSupported]);

  const stopScreenShare = useCallback(() => {
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
    }
    
    setState(prev => ({
      ...prev,
      isSharing: false,
      stream: null,
      error: null
    }));
  }, [state.stream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (state.stream) {
        state.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [state.stream]);

  return {
    ...state,
    startScreenShare,
    stopScreenShare
  };
}