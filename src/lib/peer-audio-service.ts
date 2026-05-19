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

  get ready() { return this._ready; }

  async start(roomId: string, audioTrack: MediaStreamTrack): Promise<void> {
    this.stream = new MediaStream([audioTrack]);
    const peerId = getDJPeerId(roomId);

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
        if (!this._ready) reject(err);
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
  }
}

// --- Voice Mesh (multi-user voice chat fallback) ---

export class PeerVoiceMesh {
  private peer: Peer | null = null;
  private connections: Map<string, MediaConnection> = new Map();
  private localStream: MediaStream | null = null;
  private _peerId = '';
  private _roomId = '';
  private onRemoteStream: ((peerId: string, stream: MediaStream) => void) | null = null;
  private onPeerLeft: ((peerId: string) => void) | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

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

    // Get mic
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    const peerId = `hmo-voice-${roomId}-${userId}-${Math.random().toString(36).slice(2, 6)}`;
    this._peerId = peerId;

    return new Promise((resolve, reject) => {
      this.peer = new Peer(peerId, { debug: 1 });

      this.peer.on('open', (id) => {
        console.log('[PeerVoice] Joined as', id);
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
        call.on('stream', (remoteStream) => {
          this.onRemoteStream?.(call.peer, remoteStream);
        });
        call.on('close', () => {
          this.connections.delete(call.peer);
          this.onPeerLeft?.(call.peer);
        });
        this.connections.set(call.peer, call);
      });

      this.peer.on('error', (err) => {
        console.error('[PeerVoice] Error:', err);
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
        this.callPeer(remotePeerId);
      }
    } catch {}
  }

  private callPeer(remotePeerId: string) {
    if (!this.peer || !this.localStream) return;
    console.log('[PeerVoice] Calling', remotePeerId);
    const call = this.peer.call(remotePeerId, this.localStream);
    call.on('stream', (remoteStream) => {
      this.onRemoteStream?.(remotePeerId, remoteStream);
    });
    call.on('close', () => {
      this.connections.delete(remotePeerId);
      this.onPeerLeft?.(remotePeerId);
    });
    this.connections.set(remotePeerId, call);
  }

  setMuted(muted: boolean) {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  leave() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = null;
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
  ): Promise<void> {
    const djPeerId = getDJPeerId(roomId);

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

    return new Promise((resolve, reject) => {
      this.peer = new Peer(peerId, { debug: 1 });

      this.peer.on('open', () => {
        console.log('[PeerScreen] Broadcasting as', peerId);
        this._ready = true;
        // Register in presence so viewers can discover us
        fetch('/api/peer-voice/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: `screen-${roomId}`, peerId }),
        }).catch(() => {});
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
    if (this._peerId) {
      fetch('/api/peer-voice/register', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: `screen-${this._peerId.split('-')[2]}`, peerId: this._peerId }),
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
