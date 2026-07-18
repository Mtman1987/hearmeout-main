'use client';

// PeerJS-based audio/video streaming fallback.
//
// ARCHITECTURE — Two completely separate channels:
//   1. VOICE (PeerVoiceMesh) — mic-only, bidirectional mesh between users
//      - Never carries music. Never listens to system audio.
//      - Each peer sends ONLY their getUserMedia({audio:true}) mic track.
//   2. MUSIC (PeerDJBroadcaster / PeerAudioListener) — one-way DJ→listeners
//      - DJ publishes the WebAudio output (music) to all listeners.
//      - Listeners receive only. They send a silent dummy stream to initiate.
//      - Music NEVER feeds back into voice. No echo, no loops.
//   3. SCREEN SHARE (PeerScreenShare) — one-way broadcaster→viewers
//      - Shares screen/window/camera video (+ optional audio) to all viewers.
//      - Viewers receive only. Completely independent of voice and music.
//
// For streamers: Stream Mode routes music to the OBS overlay only.
// Voices stay on the main page. Music is stripped from the VOD by capturing
// them on separate OBS sources. This preserves TOS/copyright compliance.

import Peer, { MediaConnection } from 'peerjs';

const DJ_PEER_PREFIX = 'hmo-dj-';

export function getDJPeerId(roomId: string) {
  return `${DJ_PEER_PREFIX}${roomId}`;
}

// --- DJ Side ---

export class PeerDJBroadcaster {
  private peer: Peer | null = null;
  private stream: MediaStream | null = null;
  private connections: MediaConnection[] = [];
  private _ready = false;
  private _peerId = '';

  get ready() { return this._ready; }
  get peerId() { return this._peerId; }

  async start(roomId: string, audioTrack: MediaStreamTrack, peerId = getDJPeerId(roomId)): Promise<void> {
    this.stream = new MediaStream([audioTrack]);
    this._peerId = peerId;

    return new Promise((resolve, reject) => {
      this.peer = new Peer(peerId, { debug: 1 });

      this.peer.on('open', () => {
        console.log('[PeerDJ] Ready as', peerId);
        this._ready = true;
        resolve();
      });

      this.peer.on('call', (call) => {
        console.log('[PeerDJ] Incoming listener call from', call.peer);
        call.answer(this.stream!);
        this.connections.push(call);
        call.on('close', () => {
          this.connections = this.connections.filter(c => c !== call);
        });
      });

      this.peer.on('error', (err) => {
        console.error('[PeerDJ] Error:', err);
        if (!this._ready) {
          try { this.peer?.destroy(); } catch {}
          reject(err);
        }
      });

      this.peer.on('disconnected', () => {
        // Try to reconnect to signaling server
        if (this.peer && !this.peer.destroyed) {
          this.peer.reconnect();
        }
      });
    });
  }

  updateTrack(audioTrack: MediaStreamTrack) {
    this.stream = new MediaStream([audioTrack]);
    // Replace track on all active connections
    for (const conn of this.connections) {
      try {
        const sender = (conn as any).peerConnection?.getSenders?.()?.find(
          (s: RTCRtpSender) => s.track?.kind === 'audio'
        );
        if (sender) sender.replaceTrack(audioTrack);
      } catch {}
    }
  }

  stop() {
    for (const conn of this.connections) {
      try { conn.close(); } catch {}
    }
    this.connections = [];
    try { this.peer?.destroy(); } catch {}
    this.peer = null;
    this.stream = null;
    this._ready = false;
    this._peerId = '';
  }
}

// --- Voice Mesh (multi-user voice chat fallback) ---

export class PeerVoiceMesh {
  private peer: Peer | null = null;
  private connections: Map<string, MediaConnection> = new Map();
  private localStream: MediaStream | null = null;
  private silentAudioContext: AudioContext | null = null;
  private silentOscillator: OscillatorNode | null = null;
  private _peerId = '';
  private _roomId = '';
  private onRemoteStream: ((peerId: string, stream: MediaStream) => void) | null = null;
  private onPeerLeft: ((peerId: string) => void) | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private callTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  get peerId() { return this._peerId; }
  get active() { return !!this.peer && !this.peer.destroyed; }

  async join(
    roomId: string,
    userId: string,
    onRemoteStream: (peerId: string, stream: MediaStream) => void,
    onPeerLeft: (peerId: string) => void,
  ): Promise<string> {
    this._roomId = roomId;
    this.onRemoteStream = onRemoteStream;
    this.onPeerLeft = onPeerLeft;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      console.warn('[PeerVoice] Microphone unavailable, joining with silent audio:', err);
      this.report('microphone unavailable; using silent receive-only stream', undefined, err);
      this.localStream = this.createSilentAudioStream();
    }

    const peerId = `hmo-voice-${roomId}-${userId}-${Math.random().toString(36).slice(2, 6)}`;
    this._peerId = peerId;

    return new Promise((resolve, reject) => {
      this.peer = new Peer(peerId, { debug: 1 });

      this.peer.on('open', (id) => {
        console.log('[PeerVoice] Joined as', id);
        this.report('signaling connected', id);
        // Register ourselves in the signaling "room" via the API
        this.registerPresence();
        // Start polling for other peers
        this.pollInterval = setInterval(() => this.discoverPeers(), 3000);
        resolve(id);
      });

      // Answer incoming calls from other peers
      this.peer.on('call', (call) => {
        console.log('[PeerVoice] Incoming call from', call.peer);
        call.answer(this.localStream!);
        this.trackCall(call.peer, call, 'incoming');
      });

      this.peer.on('error', (err) => {
        console.error('[PeerVoice] Error:', err);
        this.report('peer signaling error', this._peerId, err);
        if (!this.active) reject(err);
      });

      this.peer.on('disconnected', () => {
        if (this.peer && !this.peer.destroyed) this.peer.reconnect();
      });
    });
  }

  private async registerPresence() {
    try {
      await fetch('/api/peer-voice/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: this._roomId, peerId: this._peerId }),
      });
    } catch {}
  }

  private async discoverPeers() {
    try {
      const res = await fetch(`/api/peer-voice/peers?roomId=${encodeURIComponent(this._roomId)}`);
      if (!res.ok) return;
      const { peers } = await res.json() as { peers: string[] };
      for (const remotePeerId of peers) {
        if (remotePeerId === this._peerId) continue;
        if (this.connections.has(remotePeerId)) continue;
        // Only one side originates the media call. This prevents both peers
        // from creating simultaneous offers and replacing each other's call.
        if (this._peerId.localeCompare(remotePeerId) > 0) continue;
        this.callPeer(remotePeerId);
      }
    } catch {}
  }

  private callPeer(remotePeerId: string) {
    if (!this.peer || !this.localStream) return;
    console.log('[PeerVoice] Calling', remotePeerId);
    const call = this.peer.call(remotePeerId, this.localStream);
    if (!call) {
      this.report('outgoing call could not be created', remotePeerId);
      return;
    }
    this.trackCall(remotePeerId, call, 'outgoing');
  }

  private trackCall(remotePeerId: string, call: MediaConnection, direction: 'incoming' | 'outgoing') {
    const previous = this.connections.get(remotePeerId);
    if (previous && previous !== call) {
      try { previous.close(); } catch {}
    }
    this.connections.set(remotePeerId, call);
    this.report(`${direction} media call started`, remotePeerId);

    const existingTimeout = this.callTimeouts.get(remotePeerId);
    if (existingTimeout) clearTimeout(existingTimeout);
    const timeout = setTimeout(() => {
      if (this.connections.get(remotePeerId) !== call || call.remoteStream) return;
      this.report(`${direction} media call timed out before receiving audio`, remotePeerId);
      try { call.close(); } catch {}
      this.connections.delete(remotePeerId);
      this.onPeerLeft?.(remotePeerId);
    }, 15_000);
    this.callTimeouts.set(remotePeerId, timeout);

    call.on('stream', (remoteStream) => {
      clearTimeout(timeout);
      this.callTimeouts.delete(remotePeerId);
      this.report(`${direction} media stream connected`, remotePeerId);
      this.onRemoteStream?.(remotePeerId, remoteStream);
    });
    call.on('close', () => {
      clearTimeout(timeout);
      this.callTimeouts.delete(remotePeerId);
      if (this.connections.get(remotePeerId) === call) {
        this.connections.delete(remotePeerId);
        this.onPeerLeft?.(remotePeerId);
      }
      this.report(`${direction} media call closed`, remotePeerId);
    });
    call.on('error', (err) => {
      clearTimeout(timeout);
      this.callTimeouts.delete(remotePeerId);
      if (this.connections.get(remotePeerId) === call) {
        this.connections.delete(remotePeerId);
        this.onPeerLeft?.(remotePeerId);
      }
      this.report(`${direction} media call failed`, remotePeerId, err);
    });
    (call as any).on?.('iceStateChanged', (state: string) => {
      this.report(`${direction} ICE state: ${state}`, remotePeerId);
    });
  }

  private report(message: string, remotePeerId?: string, error?: unknown) {
    const details = error instanceof Error ? `${error.name}: ${error.message}` : error ? String(error) : '';
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        area: 'peer-voice',
        message: [message, remotePeerId ? `remote=${remotePeerId}` : '', details].filter(Boolean).join(' | '),
        roomId: this._roomId,
        identity: this._peerId || null,
        userAgent: navigator.userAgent,
      }),
    }).catch(() => {});
  }

  setMuted(muted: boolean) {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  private createSilentAudioStream(): MediaStream {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const destination = ctx.createMediaStreamDestination();
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    this.silentAudioContext = ctx;
    this.silentOscillator = oscillator;
    return destination.stream;
  }

  leave() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = null;
    for (const timeout of this.callTimeouts.values()) clearTimeout(timeout);
    this.callTimeouts.clear();
    // Unregister
    fetch('/api/peer-voice/register', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: this._roomId, peerId: this._peerId }),
      keepalive: true,
    }).catch(() => {});
    for (const [, conn] of this.connections) {
      try { conn.close(); } catch {}
    }
    this.connections.clear();
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }
    try { this.silentOscillator?.stop(); } catch {}
    this.silentOscillator = null;
    try { this.silentAudioContext?.close(); } catch {}
    this.silentAudioContext = null;
    try { this.peer?.destroy(); } catch {}
    this.peer = null;
  }
}

// --- Listener Side ---

export class PeerAudioListener {
  private peer: Peer | null = null;
  private call: MediaConnection | null = null;
  private _connected = false;

  get connected() { return this._connected; }

  connect(
    roomId: string,
    onTrack: (stream: MediaStream) => void,
    onDisconnect?: () => void,
    preferredDjPeerId?: string | null,
  ): Promise<void> {
    const djPeerId = preferredDjPeerId || getDJPeerId(roomId);

    return new Promise((resolve, reject) => {
      // Random listener ID
      const listenerId = `hmo-listener-${Math.random().toString(36).slice(2, 10)}`;
      this.peer = new Peer(listenerId, { debug: 1 });

      this.peer.on('open', () => {
        console.log('[PeerListener] Calling DJ at', djPeerId);
        // Call DJ with a silent stream (required by PeerJS to initiate)
        const ctx = new AudioContext();
        const oscillator = ctx.createOscillator();
        const dest = ctx.createMediaStreamDestination();
        oscillator.connect(dest);
        oscillator.start();
        // Mute it
        const gain = ctx.createGain();
        gain.gain.value = 0;
        oscillator.disconnect();
        oscillator.connect(gain);
        gain.connect(dest);

        this.call = this.peer!.call(djPeerId, dest.stream);

        this.call.on('stream', (remoteStream) => {
          console.log('[PeerListener] Received DJ audio stream');
          this._connected = true;
          onTrack(remoteStream);
          resolve();
          // Clean up the silent context
          oscillator.stop();
          ctx.close().catch(() => {});
        });

        this.call.on('close', () => {
          console.log('[PeerListener] Call closed');
          this._connected = false;
          onDisconnect?.();
        });

        this.call.on('error', (err) => {
          console.error('[PeerListener] Call error:', err);
          this._connected = false;
          reject(err);
        });

        // Timeout if DJ doesn't answer
        setTimeout(() => {
          if (!this._connected) {
            reject(new Error('DJ peer not available'));
          }
        }, 10000);
      });

      this.peer.on('error', (err) => {
        console.error('[PeerListener] Peer error:', err);
        if (!this._connected) reject(err);
      });
    });
  }

  disconnect() {
    try { this.call?.close(); } catch {}
    this.call = null;
    try { this.peer?.destroy(); } catch {}
    this.peer = null;
    this._connected = false;
  }
}


// --- Screen/Camera Share (one-to-many video broadcast) ---

const SCREEN_PEER_PREFIX = 'hmo-screen-';

export function getScreenPeerId(roomId: string, userId: string) {
  return `${SCREEN_PEER_PREFIX}${roomId}-${userId}`;
}

export type ShareSource = 'screen' | 'window' | 'camera';

export class PeerScreenShare {
  private peer: Peer | null = null;
  private stream: MediaStream | null = null;
  private connections: MediaConnection[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private registryRoomId = '';
  private _ready = false;
  private _peerId = '';

  get ready() { return this._ready; }
  get peerId() { return this._peerId; }
  get activeStream() { return this.stream; }

  async start(roomId: string, userId: string, source: ShareSource): Promise<MediaStream> {
    // Get the media based on source type
    if (source === 'camera') {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false, // Never capture audio — keeps channels separate
      });
    } else {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false, // Never capture system audio — prevents music leaking into share
      });
    }

    // If user cancels the picker, stream will have no tracks
    if (!this.stream.getVideoTracks().length) {
      this.stream = null;
      throw new Error('No video track selected');
    }

    // Listen for track ending (user clicks "Stop sharing" in browser UI)
    this.stream.getVideoTracks()[0].onended = () => {
      this.stop();
    };

    const peerId = getScreenPeerId(roomId, userId);
    this._peerId = peerId;
    this.registryRoomId = `screen-${roomId}`;

    return new Promise((resolve, reject) => {
      this.peer = new Peer(peerId, { debug: 1 });

      this.peer.on('open', () => {
        console.log('[PeerScreen] Broadcasting as', peerId);
        this._ready = true;
        // Register in presence so viewers can discover us
        const register = () => fetch('/api/peer-voice/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: this.registryRoomId, peerId }),
        }).catch(() => {});
        register();
        this.heartbeat = setInterval(register, 5000);
        resolve(this.stream!);
      });

      this.peer.on('call', (call) => {
        console.log('[PeerScreen] Viewer connected:', call.peer);
        call.answer(this.stream!);
        this.connections.push(call);
        call.on('close', () => {
          this.connections = this.connections.filter(c => c !== call);
        });
      });

      this.peer.on('error', (err) => {
        console.error('[PeerScreen] Error:', err);
        if (!this._ready) reject(err);
      });

      this.peer.on('disconnected', () => {
        if (this.peer && !this.peer.destroyed) this.peer.reconnect();
      });
    });
  }

  stop() {
    // Unregister presence
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this._peerId && this.registryRoomId) {
      fetch('/api/peer-voice/register', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: this.registryRoomId, peerId: this._peerId }),
        keepalive: true,
      }).catch(() => {});
    }
    for (const conn of this.connections) {
      try { conn.close(); } catch {}
    }
    this.connections = [];
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    try { this.peer?.destroy(); } catch {}
    this.peer = null;
    this.registryRoomId = '';
    this._ready = false;
  }
}

export class PeerScreenViewer {
  private peer: Peer | null = null;
  private call: MediaConnection | null = null;
  private _connected = false;

  get connected() { return this._connected; }

  connect(
    broadcasterPeerId: string,
    onStream: (stream: MediaStream) => void,
    onDisconnect?: () => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const viewerId = `hmo-viewer-${Math.random().toString(36).slice(2, 10)}`;
      this.peer = new Peer(viewerId, { debug: 1 });

      this.peer.on('open', () => {
        console.log('[PeerViewer] Calling broadcaster at', broadcasterPeerId);
        // Send a dummy silent video track to initiate the call
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        const ctx = canvas.getContext('2d')!;
        ctx.fillRect(0, 0, 2, 2);
        const dummyStream = canvas.captureStream(1);

        this.call = this.peer!.call(broadcasterPeerId, dummyStream);

        this.call.on('stream', (remoteStream) => {
          console.log('[PeerViewer] Received screen share stream');
          this._connected = true;
          onStream(remoteStream);
          resolve();
        });

        this.call.on('close', () => {
          this._connected = false;
          onDisconnect?.();
        });

        this.call.on('error', (err) => {
          console.error('[PeerViewer] Call error:', err);
          this._connected = false;
          reject(err);
        });

        setTimeout(() => {
          if (!this._connected) reject(new Error('Screen share peer not available'));
        }, 10000);
      });

      this.peer.on('error', (err) => {
        console.error('[PeerViewer] Peer error:', err);
        if (!this._connected) reject(err);
      });
    });
  }

  disconnect() {
    try { this.call?.close(); } catch {}
    this.call = null;
    try { this.peer?.destroy(); } catch {}
    this.peer = null;
    this._connected = false;
  }
}
