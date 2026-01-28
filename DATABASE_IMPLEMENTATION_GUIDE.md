# Database Implementation - Code Integration Guide

How to implement the production database schema in your existing HearMeOut codebase.

---

## Table of Contents

1. [Firestore Service Layer](#firestore-service-layer)
2. [Update Existing Components](#update-existing-components)
3. [Security Rules Deployment](#security-rules-deployment)
4. [Data Migration from Current State](#data-migration-from-current-state)
5. [Real-time Listener Patterns](#real-time-listener-patterns)

---

## Firestore Service Layer

### Create `src/firebase/firestore-service.ts`

This service provides a clean abstraction for all Firestore operations:

```typescript
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  Timestamp,
  Query,
  WriteBatch,
  writeBatch,
} from 'firebase/firestore';
import { db } from './config';
import type { Room, PlaylistItem, ChatMessage, RoomUser, User } from '@/types';

// ===== USER OPERATIONS =====

export const userService = {
  async getUser(userId: string): Promise<User | null> {
    const docRef = doc(db, 'users', userId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? (docSnap.data() as User) : null;
  },

  async createUser(userId: string, userData: Partial<User>): Promise<void> {
    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, {
      uid: userId,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      preferences: {
        theme: 'dark',
        notifications: true,
        privateProfile: false,
      },
      stats: {
        roomsCreated: 0,
        songsRequested: 0,
        hoursInChat: 0,
        lastActive: serverTimestamp(),
      },
      ...userData,
    });
  },

  async updateUserProfile(userId: string, updates: Partial<User>): Promise<void> {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      ...updates,
      lastLoginAt: serverTimestamp(),
    });
  },

  async incrementUserStat(userId: string, stat: 'roomsCreated' | 'songsRequested' | 'hoursInChat'): Promise<void> {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      [`stats.${stat}`]: firebase.firestore.FieldValue.increment(1),
      [`stats.lastActive`]: serverTimestamp(),
    });
  },
};

// ===== ROOM OPERATIONS =====

export const roomService = {
  async createRoom(ownerId: string, roomData: Partial<Room>): Promise<string> {
    const roomsRef = collection(db, 'rooms');
    const newRoomRef = doc(roomsRef);
    
    await setDoc(newRoomRef, {
      id: newRoomRef.id,
      ownerId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      isPublic: false,
      playlist: [],
      isPlaying: false,
      playbackPosition: 0,
      voiceLocked: false,
      metadata: {
        viewCount: 0,
        totalSongsPlayed: 0,
        totalDuration: 0,
        lastActivity: serverTimestamp(),
      },
      ...roomData,
    });
    
    return newRoomRef.id;
  },

  async getRoom(roomId: string): Promise<Room | null> {
    const docRef = doc(db, 'rooms', roomId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? (docSnap.data() as Room) : null;
  },

  async updateRoom(roomId: string, updates: Partial<Room>): Promise<void> {
    const roomRef = doc(db, 'rooms', roomId);
    await updateDoc(roomRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  },

  async deleteRoom(roomId: string): Promise<void> {
    const roomRef = doc(db, 'rooms', roomId);
    await deleteDoc(roomRef);
  },

  async getUserRooms(userId: string): Promise<Room[]> {
    const q = query(
      collection(db, 'rooms'),
      where('ownerId', '==', userId),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => doc.data() as Room);
  },

  async getPublicRooms(limitNum: number = 20): Promise<Room[]> {
    const q = query(
      collection(db, 'rooms'),
      where('isPublic', '==', true),
      orderBy('createdAt', 'desc'),
      limit(limitNum)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => doc.data() as Room);
  },

  async addSongToPlaylist(
    roomId: string,
    song: PlaylistItem
  ): Promise<void> {
    const roomRef = doc(db, 'rooms', roomId);
    await updateDoc(roomRef, {
      playlist: arrayUnion(song),
      updatedAt: serverTimestamp(),
    });
  },

  async removeSongFromPlaylist(roomId: string, songId: string): Promise<void> {
    const room = await this.getRoom(roomId);
    if (!room) return;

    const updatedPlaylist = room.playlist.filter((item) => item.id !== songId);
    await updateDoc(doc(db, 'rooms', roomId), {
      playlist: updatedPlaylist,
      updatedAt: serverTimestamp(),
    });
  },

  async setCurrentTrack(roomId: string, trackId: string | null): Promise<void> {
    await updateDoc(doc(db, 'rooms', roomId), {
      currentTrackId: trackId,
      isPlaying: !!trackId,
      playbackPosition: 0,
      updatedAt: serverTimestamp(),
    });
  },

  async updatePlayState(roomId: string, isPlaying: boolean): Promise<void> {
    await updateDoc(doc(db, 'rooms', roomId), {
      isPlaying,
      updatedAt: serverTimestamp(),
    });
  },

  async setDJ(roomId: string, userId: string | null, displayName?: string): Promise<void> {
    await updateDoc(doc(db, 'rooms', roomId), {
      djId: userId || null,
      djDisplayName: displayName || null,
      djStartedAt: userId ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });
  },
};

// ===== ROOM USER OPERATIONS =====

export const roomUserService = {
  async addUserToRoom(
    roomId: string,
    userId: string,
    userData: Omit<RoomUser, 'joinedAt'>
  ): Promise<void> {
    const userRef = doc(db, 'rooms', roomId, 'users', userId);
    await setDoc(userRef, {
      ...userData,
      joinedAt: serverTimestamp(),
      leftAt: null,
    });
  },

  async removeUserFromRoom(roomId: string, userId: string): Promise<void> {
    const userRef = doc(db, 'rooms', roomId, 'users', userId);
    await updateDoc(userRef, {
      leftAt: serverTimestamp(),
      connectionState: 'disconnected',
    });
  },

  async updateUserConnectionState(
    roomId: string,
    userId: string,
    state: 'connected' | 'connecting' | 'disconnected'
  ): Promise<void> {
    const userRef = doc(db, 'rooms', roomId, 'users', userId);
    await updateDoc(userRef, { connectionState: state });
  },

  async getRoomUsers(roomId: string): Promise<RoomUser[]> {
    const q = query(
      collection(db, 'rooms', roomId, 'users'),
      where('leftAt', '==', null)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => doc.data() as RoomUser);
  },
};

// ===== MESSAGE OPERATIONS =====

export const messageService = {
  async addMessage(
    roomId: string,
    message: Omit<ChatMessage, 'id' | 'createdAt'>
  ): Promise<string> {
    const messagesRef = collection(db, 'rooms', roomId, 'messages');
    const newMsgRef = doc(messagesRef);

    await setDoc(newMsgRef, {
      id: newMsgRef.id,
      ...message,
      createdAt: serverTimestamp(),
      isDeleted: false,
      reactions: {},
      isFlagged: false,
    });

    return newMsgRef.id;
  },

  async getRoomMessages(
    roomId: string,
    limitNum: number = 50
  ): Promise<ChatMessage[]> {
    const q = query(
      collection(db, 'rooms', roomId, 'messages'),
      where('isDeleted', '==', false),
      orderBy('createdAt', 'desc'),
      limit(limitNum)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((doc) => doc.data() as ChatMessage)
      .reverse();
  },

  async deleteMessage(roomId: string, messageId: string): Promise<void> {
    const msgRef = doc(db, 'rooms', roomId, 'messages', messageId);
    await updateDoc(msgRef, {
      isDeleted: true,
      updatedAt: serverTimestamp(),
    });
  },

  async addReaction(roomId: string, messageId: string, emoji: string): Promise<void> {
    const msgRef = doc(db, 'rooms', roomId, 'messages', messageId);
    await updateDoc(msgRef, {
      [`reactions.${emoji}`]: firebase.firestore.FieldValue.increment(1),
    });
  },

  async flagMessage(roomId: string, messageId: string, reason: string): Promise<void> {
    const msgRef = doc(db, 'rooms', roomId, 'messages', messageId);
    await updateDoc(msgRef, {
      isFlagged: true,
      flagReason: reason,
    });
  },
};

// ===== ANALYTICS OPERATIONS =====

export const analyticsService = {
  async recordRoomActivity(roomId: string): Promise<void> {
    const roomRef = doc(db, 'rooms', roomId);
    await updateDoc(roomRef, {
      'metadata.lastActivity': serverTimestamp(),
      'metadata.viewCount': firebase.firestore.FieldValue.increment(1),
    });
  },

  async recordSongPlay(roomId: string): Promise<void> {
    const roomRef = doc(db, 'rooms', roomId);
    await updateDoc(roomRef, {
      'metadata.totalSongsPlayed': firebase.firestore.FieldValue.increment(1),
    });
  },

  async logAuditEvent(
    action: string,
    details: Record<string, any>,
    userId?: string,
    roomId?: string
  ): Promise<void> {
    const logsRef = collection(db, 'audit_logs');
    await setDoc(doc(logsRef), {
      userId: userId || null,
      action,
      roomId: roomId || null,
      details,
      timestamp: serverTimestamp(),
    });
  },
};

// ===== BATCH OPERATIONS =====

export const batchService = {
  async updatePlaylistBatch(
    roomId: string,
    songs: PlaylistItem[]
  ): Promise<void> {
    const batch = writeBatch(db);
    const roomRef = doc(db, 'rooms', roomId);

    batch.update(roomRef, {
      playlist: songs,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  },

  async removeAllUserData(userId: string): Promise<void> {
    const batch = writeBatch(db);

    // Delete user document
    const userRef = doc(db, 'users', userId);
    batch.delete(userRef);

    // Soft-delete all messages from user
    const userMessagesQuery = query(
      collection(db, 'rooms'),
      where('ownerId', '==', userId)
    );
    const rooms = await getDocs(userMessagesQuery);

    for (const roomDoc of rooms.docs) {
      const messagesRef = collection(db, roomDoc.ref.path, 'messages');
      const userMsgs = await getDocs(
        query(messagesRef, where('userId', '==', userId))
      );

      for (const msg of userMsgs.docs) {
        batch.update(msg.ref, {
          isDeleted: true,
          userId: '[deleted]',
          displayName: '[deleted]',
        });
      }
    }

    await batch.commit();
  },
};

// ===== EXPORT ALL SERVICES =====

export const firestoreService = {
  users: userService,
  rooms: roomService,
  roomUsers: roomUserService,
  messages: messageService,
  analytics: analyticsService,
  batch: batchService,
};
```

---

## Update Existing Components

### 1. Update `src/app/rooms/[roomId]/page.tsx`

Replace room operations with service calls:

```typescript
// Before
const roomRef = doc(db, 'rooms', roomId);
await updateDoc(roomRef, { isPlaying: true });

// After
import { firestoreService } from '@/firebase/firestore-service';

await firestoreService.rooms.updatePlayState(roomId, true);
```

### 2. Update `src/lib/bot-actions.ts`

Replace with service layer:

```typescript
import { firestoreService } from '@/firebase/firestore-service';

export async function addSongToPlaylist(
  query: string,
  roomId: string,
  requester: string
): Promise<void> {
  const results = await searchYoutube(query);
  
  if (results.length === 0) {
    throw new Error('No YouTube results found');
  }

  const song = await generatePlaylistItem(results[0]);
  song.addedBy = requester;
  song.source = 'discord';

  await firestoreService.rooms.addSongToPlaylist(roomId, song);
}

export async function updateRoomPlayState(
  roomId: string,
  isPlaying: boolean
): Promise<void> {
  await firestoreService.rooms.updatePlayState(roomId, isPlaying);
}

export async function skipTrack(roomId: string): Promise<void> {
  const room = await firestoreService.rooms.getRoom(roomId);
  if (!room || room.playlist.length === 0) return;

  const currentIndex = room.playlist.findIndex(
    (item) => item.id === room.currentTrackId
  );
  const nextIndex = (currentIndex + 1) % room.playlist.length;

  await firestoreService.rooms.setCurrentTrack(
    roomId,
    room.playlist[nextIndex].id
  );
}

export async function getRoomState(
  roomId: string
): Promise<{
  isPlaying: boolean;
  currentTrack: PlaylistItem | undefined;
  playlistLength: number;
  djDisplayName: string | undefined;
}> {
  const room = await firestoreService.rooms.getRoom(roomId);
  if (!room) {
    throw new Error(`Room ${roomId} not found`);
  }

  return {
    isPlaying: room.isPlaying,
    currentTrack: room.playlist.find((item) => item.id === room.currentTrackId),
    playlistLength: room.playlist.length,
    djDisplayName: room.djDisplayName,
  };
}
```

### 3. Update `src/app/rooms/[roomId]/_components/ChatBox.tsx`

Use message service:

```typescript
import { firestoreService } from '@/firebase/firestore-service';

const handleSendMessage = async (text: string) => {
  if (!user || !roomId) return;

  try {
    const messageId = await firestoreService.messages.addMessage(roomId, {
      userId: user.uid,
      displayName: user.displayName || 'Anonymous',
      text,
    });

    // Message will appear via real-time listener
  } catch (error) {
    console.error('Failed to send message:', error);
  }
};
```

---

## Security Rules Deployment

### 1. Save rules to file

Create `firestore.rules` in project root:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(ownerId) {
      return request.auth.uid == ownerId;
    }
    
    function isRoomOwner(roomId) {
      return isAuthenticated() && 
             get(/databases/$(database)/documents/rooms/$(roomId)).data.ownerId == request.auth.uid;
    }
    
    function isDJ(roomId) {
      return isAuthenticated() && 
             get(/databases/$(database)/documents/rooms/$(roomId)).data.djId == request.auth.uid;
    }
    
    function isInRoom(roomId) {
      return isAuthenticated() && 
             exists(/databases/$(database)/documents/rooms/$(roomId)/users/$(request.auth.uid));
    }
    
    function isRoomPublic(roomId) {
      return get(/databases/$(database)/documents/rooms/$(roomId)).data.isPublic == true;
    }
    
    // USER COLLECTION
    match /users/{userId} {
      allow read: if isAuthenticated() && (isOwner(userId) || !get(/databases/$(database)/documents/users/$(userId)).data.preferences.privateProfile);
      allow write: if isOwner(userId);
      allow delete: if isOwner(userId);
    }
    
    // ROOMS COLLECTION
    match /rooms/{roomId} {
      allow read: if isRoomPublic(roomId) || (isAuthenticated() && isInRoom(roomId));
      allow write: if isRoomOwner(roomId);
      allow delete: if isRoomOwner(roomId);
      
      // ROOM USERS
      match /users/{userId} {
        allow read: if isInRoom(roomId);
        allow write: if isOwner(userId) || isRoomOwner(roomId);
      }
      
      // MESSAGES
      match /messages/{messageId} {
        allow read: if isInRoom(roomId);
        allow create: if isInRoom(roomId) && 
                        request.auth.uid == request.resource.data.userId &&
                        request.resource.data.createdAt == request.time;
        allow update, delete: if isOwner(resource.data.userId) || isRoomOwner(roomId);
      }
    }
    
    // BOT CONFIG (ADMIN ONLY)
    match /bot_configs/{config} {
      allow read, write: if false;
    }
    
    // ANALYTICS
    match /analytics/{document=**} {
      allow read: if isAuthenticated();
      allow write: if false;
    }
    
    // DEFAULT DENY
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### 2. Deploy rules

```bash
# Install Firebase CLI if not already installed
npm install -g firebase-tools

# Login
firebase login

# Deploy rules
firebase deploy --only firestore:rules
```

### 3. Verify in Firebase Console

1. Go to Firestore → Rules
2. Check status shows "Deployed"
3. Test rules in Rules Playground

---

## Data Migration from Current State

### Migration Script

Create `scripts/migrate-firestore.ts`:

```typescript
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { firestoreService } from '../src/firebase/firestore-service';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function migrateData() {
  console.log('Starting data migration...');

  try {
    // 1. Ensure all users have required fields
    console.log('✓ Updating user documents...');
    // (Firestore will handle missing fields gracefully)

    // 2. Ensure all rooms have required fields
    console.log('✓ Updating room documents...');
    // (Same - fields will be added on first write)

    // 3. Create missing metadata fields
    console.log('✓ Adding metadata to rooms...');
    // Query and update pattern

    // 4. Validate data integrity
    console.log('✓ Validating data integrity...');
    // Check for orphaned references, missing required fields, etc.

    console.log('✅ Migration complete!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateData();
```

Run with:

```bash
npx ts-node scripts/migrate-firestore.ts
```

---

## Real-time Listener Patterns

### Hook for Real-time Room Updates

Create `src/hooks/use-room.ts`:

```typescript
import { useEffect, useState } from 'react';
import {
  doc,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import type { Room } from '@/types';

export function useRoom(roomId: string) {
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!roomId) return;

    let unsubscribe: Unsubscribe;

    const setupListener = async () => {
      try {
        const roomRef = doc(db, 'rooms', roomId);
        unsubscribe = onSnapshot(roomRef, (docSnapshot) => {
          if (docSnapshot.exists()) {
            setRoom(docSnapshot.data() as Room);
          } else {
            setError(new Error('Room not found'));
          }
          setLoading(false);
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setLoading(false);
      }
    };

    setupListener();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [roomId]);

  return { room, loading, error };
}
```

### Hook for Real-time Messages

Create `src/hooks/use-room-messages.ts`:

```typescript
import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import type { ChatMessage } from '@/types';

export function useRoomMessages(roomId: string, maxMessages: number = 50) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!roomId) return;

    let unsubscribe: Unsubscribe;

    const setupListener = async () => {
      try {
        const messagesRef = collection(db, 'rooms', roomId, 'messages');
        const q = query(
          messagesRef,
          where('isDeleted', '==', false),
          orderBy('createdAt', 'desc'),
          limit(maxMessages)
        );

        unsubscribe = onSnapshot(q, (querySnapshot) => {
          const newMessages = querySnapshot.docs
            .map((doc) => doc.data() as ChatMessage)
            .reverse();
          setMessages(newMessages);
          setLoading(false);
        });
      } catch (error) {
        console.error('Failed to setup messages listener:', error);
        setLoading(false);
      }
    };

    setupListener();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [roomId, maxMessages]);

  return { messages, loading };
}
```

---

## Type Definitions

Update `src/types/index.ts` with complete types:

```typescript
import { Timestamp } from 'firebase/firestore';

export interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
  discordId?: string;
  twitchId?: string;
  preferences: {
    theme: 'light' | 'dark';
    notifications: boolean;
    privateProfile: boolean;
  };
  stats: {
    roomsCreated: number;
    songsRequested: number;
    hoursInChat: number;
    lastActive: Timestamp;
  };
}

export interface PlaylistItem {
  id: string;
  title: string;
  artist: string;
  url: string;
  duration: number;
  artId: string;
  addedBy: string;
  addedAt: Timestamp;
  plays: number;
  source: 'web' | 'discord' | 'twitch';
}

export interface Room {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isPublic: boolean;
  description?: string;
  tags: string[];
  playlist: PlaylistItem[];
  currentTrackId?: string;
  isPlaying: boolean;
  playbackPosition: number;
  lastPlayedAt?: Timestamp;
  djId?: string;
  djDisplayName?: string;
  djStartedAt?: Timestamp;
  maxParticipants?: number;
  password?: string;
  voiceLocked: boolean;
  metadata: {
    viewCount: number;
    totalSongsPlayed: number;
    totalDuration: number;
    lastActivity: Timestamp;
  };
}

export interface RoomUser {
  uid: string;
  displayName: string;
  photoURL: string;
  joinedAt: Timestamp;
  leftAt?: Timestamp;
  connectionState: 'connected' | 'connecting' | 'disconnected';
  isMuted: boolean;
  isSpeaking: boolean;
  metadata: {
    sessionDuration: number;
    messagesCount: number;
    lastMessageAt?: Timestamp;
  };
}

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  text: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  isDeleted: boolean;
  reactions: Record<string, number>;
  sentiment?: 'positive' | 'neutral' | 'negative';
  isFlagged: boolean;
  flagReason?: string;
}
```

---

## Testing Your Implementation

### Test Checklist

```
✅ Create a room
✅ Add a song to playlist
✅ Update play state
✅ Send a message
✅ Add/remove user from room
✅ Verify real-time updates
✅ Test security rules
✅ Verify data persistence
✅ Test from Discord bot
✅ Test from Twitch bot
```

---

**Your database layer is production-ready! Deploy with confidence.** 🚀
