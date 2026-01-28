# CliqueyTalk Bot & Authentication Integration Guide

This document provides a detailed walkthrough of the key integration points for Discord, Twitch, and the audio bot within the CliqueyTalk application. It covers OAuth2 authentication flows, music requests, and how audio playback is controlled.

---

## 1. Authentication Flows

The application uses OAuth2 to authenticate users with Discord and to authorize the Twitch bot. The session management for app users relies on a combination of Discord's access token and a custom Firebase Authentication token.

### 1.1. Discord User Authentication

This is a three-step process to sign a user into the application.

**Step 1: Redirect to Discord (`/api/auth/login/route.ts`)**

This route constructs the Discord OAuth2 authorization URL with the required scopes (`identify`, `email`, `guilds`) and redirects the user. A unique `state` parameter is generated and stored in a cookie to prevent CSRF attacks.

```typescript
// File: src/api/auth/login/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getLatestSecret } from '@/lib/secrets';
import { randomUUID } from 'crypto';

export async function GET(req: NextRequest) {
  try {
    // SECRET: You must create this in Google Secret Manager.
    const clientId = await getLatestSecret('DISCORD_CLIENT_ID');

    // The base URL of your deployed application.
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).trim();
    const redirectUri = `${appUrl}/api/auth/callback`;

    // Scopes define what permissions we're asking from the user.
    const scopes = ['identify', 'email', 'guilds'].join(' ');

    // Generate a random value for the 'state' parameter to prevent CSRF.
    const state = randomUUID();

    // Construct the full authorization URL.
    const authUrl = new URL('https://discord.com/api/oauth2/authorize');
    authUrl.searchParams.set('client_id', clientId.trim());
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('prompt', 'consent'); // Force user to re-approve.
    authUrl.searchParams.set('state', state);

    // Redirect the user to Discord's login page.
    const res = NextResponse.redirect(authUrl);

    // Store the 'state' in a secure, httpOnly cookie to verify on callback.
    res.cookies.set('discord_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 10 * 60, // 10 minutes
    });
    return res;

  } catch (error) {
    // Handle cases where secrets are not configured.
    console.error('An unexpected error occurred during Discord authentication setup:', error);
    if (error instanceof Error) {
      return new Response(
        `Discord OAuth is not configured. ${error.message}`,
        { status: 503 }
      );
    }
    return new Response('Discord OAuth is not configured.', { status: 503 });
  }
}
```

**Step 2: Handle Discord Callback (`/api/auth/callback/route.ts`)**

After the user authorizes the app, Discord redirects them back to this route. This server-side code exchanges the `code` from Discord for an `access_token`. This token is then stored in a secure, HTTP-only cookie.

```typescript
// File: src/api/auth/callback/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getLatestSecret } from '@/lib/secrets';

export async function GET(req: NextRequest) {
  // Extract the authorization code and state from the URL.
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');

  if (!code) {
    return new Response('Authorization failed: No code provided.', { status: 400 });
  }

  // Verify the 'state' parameter matches the one we stored in the cookie.
  const expectedState = req.cookies.get('discord_oauth_state')?.value;
  if (!state || !expectedState || state !== expectedState) {
    return new Response('Authorization failed: Invalid state.', { status: 400 });
  }

  try {
    // SECRETS: You must create these in Google Secret Manager.
    const [clientId, clientSecret] = await Promise.all([
      getLatestSecret('DISCORD_CLIENT_ID'),
      getLatestSecret('DISCORD_CLIENT_SECRET'),
    ]);

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).trim();
    const redirectUri = `${appUrl}/api/auth/callback`;

    // Prepare the request body to exchange the code for a token.
    const params = new URLSearchParams();
    params.append('client_id', clientId.trim());
    params.append('client_secret', clientSecret.trim());
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);

    // Make the POST request to Discord's token endpoint.
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
        console.error('Failed to fetch access token:', tokenData);
        return new Response(`Failed to fetch access token: ${tokenData.error_description || 'Unknown error'}`, { status: 500 });
    }

    // Redirect the user to the main application dashboard.
    const dashboardUrl = new URL('/dashboard', appUrl);
    const res = NextResponse.redirect(dashboardUrl);

    // Clear the state cookie as it's no longer needed.
    res.cookies.set('discord_oauth_state', '', { maxAge: 0 });

    // Store the Discord access token in a secure, httpOnly cookie.
    // The client-side JavaScript cannot access this cookie.
    res.cookies.set('discord_access_token', tokenData.access_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60, // 1 hour
    });

    return res;

  } catch (error) {
    // Handle configuration errors.
    console.error('An unexpected error occurred during authentication:', error);
    if (error instanceof Error) {
      return new Response(
        `Discord OAuth is not configured. ${error.message}`,
        { status: 503 }
      );
    }
    return new Response('Discord OAuth is not configured.', { status: 503 });
  }
}
```

**Step 3: Create Firebase Session (`/api/auth/firebase-token/route.ts`)**

The client-side code calls this endpoint. It reads the `discord_access_token` from the cookie, uses it to fetch the user's Discord profile, and then creates a **custom Firebase Auth token**. This securely signs the user into Firebase with their Discord ID as their UID.

```typescript
// File: src/api/auth/firebase-token/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { auth as adminAuth, db } from '@/firebase/admin';
import { requireDiscordSession } from '@/lib/discord-session';
import { getLatestSecretCached } from '@/lib/secrets';

// Helper function to fetch user roles from your Discord server.
// Requires a Discord Bot with necessary permissions.
async function fetchMemberRoles(botToken: string, guildId: string, userId: string): Promise<string[]> {
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: 'no-store',
  });
  if (!res.ok) return []; // User might not be in the guild.
  const data = await res.json();
  return Array.isArray(data.roles) ? data.roles : [];
}

export async function GET(req: NextRequest) {
  try {
    // This helper reads the Discord token from the cookie and fetches the user profile.
    const { user: discordUser } = await requireDiscordSession(req);

    // SECRETS: These are required for checking user roles for admin access.
    const guildId = await getLatestSecretCached('DISCORD_GUILD_ID');
    const botToken = await getLatestSecretCached('DISCORD_BOT_TOKEN');

    // Fetch the user's roles from your specific Discord server.
    const memberRoles = await fetchMemberRoles(botToken, guildId, discordUser.id);
    
    // In this app, admin roles are stored in Firestore for dynamic configuration.
    const adminRolesDoc = await db.collection('app_settings').doc('admin_roles').get();
    const adminRoleIds = adminRolesDoc.exists ? (adminRolesDoc.data()?.roles ?? []) : [];
    const hasAdminRole = memberRoles.some((roleId) => adminRoleIds.includes(roleId));

    // For this app, we'll consider having an admin role as being an admin.
    const isAdmin = hasAdminRole;

    // Use the user's unique Discord ID as their Firebase UID.
    const firebaseUid = discordUser.id;

    // Create a custom token with additional claims (like isAdmin).
    // These claims can be used in Firestore Security Rules.
    const customToken = await adminAuth.createCustomToken(firebaseUid, {
      discordId: discordUser.id,
      isAdmin,
    });

    // Return the token to the client. The client will use this to sign in.
    return NextResponse.json({ token: customToken, discordId: discordUser.id, isAdmin });

  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: 401 });
  }
}
```

### 1.2. Twitch Bot Authentication

This flow is simpler and is only used to get a token for the server-side bot to operate.

**Step 1: Redirect to Twitch (`/api/auth/twitch/login/route.ts`)**

Similar to Discord, this constructs the Twitch OAuth2 URL with the required scopes for the bot (e.g., reading channel redemptions).

```typescript
// File: src/api/auth/twitch/login/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getLatestSecret } from '@/lib/secrets';
import { randomUUID } from 'crypto';

export async function GET(req: NextRequest) {
  try {
    // SECRET: You must create this in Google Secret Manager.
    const clientId = await getLatestSecret('TWITCH_CLIENT_ID');
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).trim();
    const redirectUri = `${appUrl}/api/auth/twitch/callback`;

    // Define the permissions the bot needs.
    const scopes = ['channel:read:redemptions', 'channel:manage:redemptions', 'user:read:email', 'moderation:read', 'channel:read:subscriptions'].join(' ');
    const state = randomUUID();

    const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    authUrl.searchParams.set('client_id', clientId.trim());
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('state', state);

    const res = NextResponse.redirect(authUrl);
    res.cookies.set('twitch_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 10 * 60 });
    return res;
  } catch (error) {
    // ... error handling
    console.error('An unexpected error occurred during Twitch authentication setup:', error);
    if (error instanceof Error) {
      return new Response(
        `Twitch OAuth is not configured. ${error.message}`,
        { status: 503 }
      );
    }
    return new Response('Twitch OAuth is not configured.', { status: 503 });
  }
}
```

**Step 2: Handle Twitch Callback & Store Credentials**

This route exchanges the code for a token, but crucially, it also gets a `refresh_token`. Both tokens are then stored securely in a Firestore document (`app_settings/twitch_bot_credentials`). The `twitch-bot.ts` service will read from this document to get a valid token, refreshing it automatically when it expires.

```typescript
// File: src/services/twitch-bot.ts

import { db } from '@/firebase/admin';
import { getLatestSecretCached } from '@/lib/secrets';

// This function is called by the bot service to get a valid token.
async function getValidAccessToken(): Promise<string> {
    const credsRef = db.collection('app_settings').doc('twitch_bot_credentials');
    const credsDoc = await credsRef.get();

    if (!credsDoc.exists) {
        throw new Error('Twitch account not connected. Please connect via the admin panel.');
    }
    const credentials = credsDoc.data()!;

    // Check if the token is about to expire.
    if (Date.now() + 60000 > credentials.expiresAt) {
        console.log('Refreshing Twitch token...');
        
        // SECRETS: Needed to refresh the token.
        const [clientId, clientSecret] = await Promise.all([
            getLatestSecretCached('TWITCH_CLIENT_ID'),
            getLatestSecretCached('TWITCH_CLIENT_SECRET'),
        ]);

        // Use the refresh_token to get a new access_token.
        const params = new URLSearchParams({
            client_id: clientId.trim(),
            client_secret: clientSecret.trim(),
            grant_type: 'refresh_token',
            refresh_token: credentials.refreshToken,
        });

        const response = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        });

        const tokenData = await response.json();
        if (!response.ok) {
            // If refresh fails, the old credentials are bad. Delete them.
            await credsRef.delete();
            throw new Error(`Failed to refresh token: ${tokenData.message}. Please re-authorize from the admin panel.`);
        }

        // Store the new tokens and expiration time in Firestore.
        const newCredentials = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: Date.now() + (tokenData.expires_in * 1000),
        };
        await credsRef.set(newCredentials);
        console.log('Successfully refreshed and stored new Twitch token.');
        return newCredentials.accessToken;
    }
    
    // If the token is still valid, just return it.
    return credentials.accessToken;
}
```

---

## 2. Music Request & Playback Flow

The music bot is controlled entirely through Firestore. Commands from Twitch or Discord write to the `music_queue` collection, and a state document (`app_settings/audio_bot_state`) tells clients what to play.

### 2.1. Requesting a Song (Twitch Example)

The Twitch bot listens for `!sr <song>` in chat.

```typescript
// File: src/services/twitch-bot.ts

import tmi from 'tmi.js';
import { processSongRequest } from '@/lib/audio-bot-actions';

// Inside the tmi.Client setup...
const newClient = new tmi.Client({
    // ... options
});

newClient.on('message', async (channel, tags, message, self) => {
    if(self) return;

    const requester = tags['display-name'] || 'Someone';

    // Check for the song request command.
    if (message.toLowerCase().startsWith('!sr ')) {
        const request = message.substring(4).trim();
        if (!request) return;

        try {
            // This is the core logic, shared by all request sources.
            const result = await processSongRequest(request, requester);

            if (result.success) {
                const successMessage = result.message.replace('queued up', 'Queued up'); 
                newClient.say(channel, `@${requester}, ${successMessage}.`);
            } else {
                newClient.say(channel, `@${requester}, sorry, an error occurred: ${result.message}`);
            }

        } catch (error: any) {
            console.error('Error during Twitch song request:', error);
            newClient.say(channel, `@${requester}, sorry, an internal server error occurred.`);
        }
        return;
    }
});
```

### 2.2. Processing the Request (Server-Side)

The `processSongRequest` function (in `lib/audio-bot-actions.ts`) does the heavy lifting. It uses the `youtube-sr` library to search YouTube and then adds the song details to the `music_queue` collection in Firestore.

```typescript
// File: src/lib/audio-bot-actions.ts

'use server';

import { db } from '@/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { YouTube } from 'youtube-sr'; // Robust library for YouTube searching.

// Type for a queue item.
interface MusicQueueItem {
    url?: string; // YouTube URL or storage path
    title: string;
    requestedBy: string;
    requesterId?: string;
    addedAt: FieldValue;
    isStorage: boolean; // Flag to differentiate
}

export async function processSongRequest(songRequest: string, requesterName: string, requesterId?: string): Promise<{success: boolean, message: string}> {
    const queueRef = db.collection('music_queue');
    const audioBotStateRef = db.collection('app_settings').doc('audio_bot_state');

    try {
        // ... (logic for handling playlists is omitted for brevity)

        // Search YouTube for the video.
        const isUrl = YouTube.isYouTube(songRequest, {checkVideo: true});
        let video;

        if (isUrl) {
            video = await YouTube.getVideo(songRequest);
        } else {
            const searchResults = await YouTube.search(songRequest, { limit: 1, type: 'video' });
            if (searchResults.length === 0) {
                return { success: false, message: `I couldn't find a song matching "${songRequest}".` };
            }
            video = searchResults[0];
        }

        if (!video) {
            return { success: false, message: `I couldn't find a song matching "${songRequest}".` };
        }

        // Create the new song document data.
        const songData = {
            url: video.url,
            title: video.title || 'Unknown Title',
            requestedBy: requesterName,
            requesterId: requesterId,
            isStorage: false,
            addedAt: FieldValue.serverTimestamp(),
        };
        // Add the song to the Firestore queue.
        await queueRef.add(songData);

        // Check if the bot is currently stopped. If so, trigger it to play the next song.
        const botStateDoc = await audioBotStateRef.get();
        const botState = botStateDoc.data();
        if (!botStateDoc.exists || botState?.status === 'stopped') {
            await playNextSongInQueue();
        }
        
        return { success: true, message: `Queued up: "${songData.title}"` };

    } catch (error: any) {
        console.error('Error during song request processing:', error);
        return { success: false, message: 'An internal error occurred while processing your song request.' };
    }
}
```

### 2.3. Playback Control (Client-Side)

The actual audio playback is handled on the client in the `AudioBotCard` component. It does **not** have a direct WebRTC connection to a "bot user". Instead, it listens to changes in the `app_settings/audio_bot_state` document and uses a hidden `ReactPlayer` to stream the audio from the URL specified in that document.

Only the channel creator (`isController`) can send commands (play, pause, skip) which are just writes to this same Firestore document.

```typescript
// File: src/components/channel/voice-channel.tsx

'use client';

import { useDoc, useMemoFirebase, useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import ReactPlayer from 'react-player';
import { useCallback, useEffect, useState } from 'react';
import { playNextSong } from '@/lib/actions';


function AudioBotCard({ isController }: { isController: boolean }) {
    const firestore = useFirestore();
    
    // Listen to the global audio bot state document.
    const audioBotStateRef = useMemoFirebase(() => {
        if (!firestore) return null;
        return doc(firestore, 'app_settings', 'audio_bot_state');
    }, [firestore]);
    const { data: audioBotState } = useDoc<any>(audioBotStateRef);

    const [isPlaying, setIsPlaying] = useState(false);
    
    // The server action that tells the bot to advance to the next song.
    const playNextInQueue = useCallback(async () => {
        if (isController) {
            // This is a server action defined in 'lib/actions.ts'
            playNextSong();
        }
    }, [isController]);

    // Update the player's playing state based on Firestore.
    useEffect(() => {
        setIsPlaying(audioBotState?.status === 'playing');
    }, [audioBotState?.status]);

    // The ReactPlayer component handles streaming the audio.
    // It is hidden from view.
    return (
        <Card>
            {/* ... UI for play/pause/skip buttons ... */}
            
            <div className="hidden">
                 <ReactPlayer
                    url={audioBotState?.currentSongUrl || ''}
                    playing={isPlaying}
                    volume={0.5 /* example volume */}
                    onEnded={playNextInQueue} // When a song finishes, the controller tells the server to play the next one.
                    controls={false}
                    width="1px"
                    height="1px"
                 />
            </div>

            {/* ... UI for queue and soundboard ... */}
        </Card>
    );
}

```

---

## 3. WebRTC Voice/Video Communication

This is for peer-to-peer communication between users in a channel. It is **separate** from the audio bot playback. All of this logic is handled in the `use-webrtc.ts` hook.

```typescript
// File: src/hooks/use-webrtc.ts

// ... imports

export function useWebRTC(
  channelId: string | null,
  isVideo: boolean,
  isUserInChannel: boolean,
  userProfileRef: DocumentReference | null,
  botAudioTrack: MediaStreamTrack | null,
  audioContext: AudioContext | null,
) {
    // ... state for local and remote streams

    useEffect(() => {
        // This is the main signaling effect. It runs when a user joins a channel.
        if (!isUserInChannel || !localStream || !firestore || !discordId || !channelId) return;

        // A reference to the Firestore document for this voice channel.
        const channelRef = doc(firestore, 'voice_channels', channelId);

        // This function creates a new RTCPeerConnection for a given peer.
        const createPeerConnection = (peerId: string) => {
            const pc = new RTCPeerConnection(servers);
            
            // Add local media tracks to send to the other peer.
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

            // When a track is received from the other peer, add it to the remoteStreams state.
            pc.ontrack = (event) => {
                setRemoteStreams(prev => ({ ...prev, [peerId]: event.streams[0] }));
            };

            // --- Firestore Signaling ---
            // The hook sets up listeners on subcollections within the channel document
            // (e.g., 'peers/{peerId}/offers', 'peers/{peerId}/answers')
            // to exchange signaling messages (SDP offers/answers and ICE candidates).

            // When an offer is received, it creates an answer and sends it back.
            // When an answer is received, it completes the connection.
            // ICE candidates are exchanged to find the best network path.
        };

        // Listen for changes to the channel's participant list.
        // Create connections for new participants and clean up for those who leave.
        const participantUnsub = onSnapshot(channelRef, (channelSnap) => {
            const remotePeers = (channelSnap.data().participantIds || []).filter((id: string) => id !== discordId);
            
            // Logic to create connections for new peers and tear down for removed peers.
        });

        // ... cleanup logic
    }, [isUserInChannel, localStream, /* ... */]);

    return { localStream, remoteStreams, /* ... */ };
}
```

This guide covers the primary workflows. The key takeaway is the separation of concerns:
- **OAuth2** is handled by dedicated server routes.
- **Bot logic** is centralized in server-side actions that manipulate Firestore.
- **Client-side UI** is reactive, listening to Firestore for state changes to control things like audio playback, without needing direct connections to the "bot".
- **User-to-user WebRTC** uses Firestore as a signaling bus to coordinate peer connections.
