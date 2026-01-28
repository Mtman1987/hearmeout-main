# Production Database Structure - Complete Guide

Complete Firestore schema, security rules, and best practices for HearMeOut production deployment.

---

## Table of Contents

1. [Database Schema](#database-schema)
2. [Firestore Security Rules](#firestore-security-rules)
3. [Indexes Required](#indexes-required)
4. [Data Persistence Strategy](#data-persistence-strategy)
5. [Backup & Recovery](#backup--recovery)
6. [Migration Guide](#migration-guide)

---

## Database Schema

### Complete Collection Structure

```
firestore/
├── users/
│   └── {userId}
│       ├── uid: string
│       ├── email: string
│       ├── displayName: string
│       ├── photoURL: string
│       ├── createdAt: timestamp
│       ├── lastLoginAt: timestamp
│       ├── discordId?: string
│       ├── twitchId?: string
│       ├── preferences: object
│       │   ├── theme: "light" | "dark"
│       │   ├── notifications: boolean
│       │   └── privateProfile: boolean
│       └── stats: object
│           ├── roomsCreated: number
│           ├── songsRequested: number
│           ├── hoursInChat: number
│           └── lastActive: timestamp
│
├── rooms/
│   └── {roomId}
│       ├── id: string (document ID)
│       ├── name: string (required)
│       ├── ownerId: string (required, foreign key → users)
│       ├── createdAt: timestamp (required)
│       ├── updatedAt: timestamp (required)
│       ├── isPublic: boolean (default: false)
│       ├── description?: string
│       ├── tags: array<string> (for discovery)
│       │
│       ├── playlist: array<PlaylistItem>
│       │   └── [0..n]
│       │       ├── id: string (YouTube video ID)
│       │       ├── title: string
│       │       ├── artist: string
│       │       ├── url: string (YouTube URL)
│       │       ├── duration: number (seconds)
│       │       ├── artId: string (album art reference)
│       │       ├── addedBy: string (userId)
│       │       ├── addedAt: timestamp
│       │       ├── plays: number (0 for new songs)
│       │       └── source: "web" | "discord" | "twitch"
│       │
│       ├── currentTrackId?: string (foreign key → playlist[].id)
│       ├── isPlaying: boolean (default: false)
│       ├── playbackPosition: number (seconds, 0 for new)
│       ├── lastPlayedAt?: timestamp
│       │
│       ├── djId?: string (foreign key → users, null if no DJ)
│       ├── djDisplayName?: string
│       ├── djStartedAt?: timestamp (when DJ took control)
│       │
│       ├── maxParticipants?: number (null = unlimited)
│       ├── password?: string (hashed, if private)
│       ├── voiceLocked: boolean (only DJ can control)
│       │
│       └── metadata: object
│           ├── viewCount: number
│           ├── totalSongsPlayed: number
│           ├── totalDuration: number (seconds)
│           └── lastActivity: timestamp
│
├── rooms/{roomId}/users/
│   └── {userId}
│       ├── uid: string (same as userId, for redundancy)
│       ├── displayName: string
│       ├── photoURL: string
│       ├── joinedAt: timestamp
│       ├── leftAt?: timestamp (null if still in room)
│       ├── connectionState: "connected" | "connecting" | "disconnected"
│       ├── isMuted: boolean
│       ├── isSpeaking: boolean
│       └── metadata: object
│           ├── sessionDuration: number (seconds)
│           ├── messagesCount: number
│           └── lastMessageAt?: timestamp
│
├── rooms/{roomId}/messages/
│   └── {messageId}
│       ├── id: string (document ID)
│       ├── userId: string (foreign key → users)
│       ├── displayName: string (denormalized for performance)
│       ├── text: string
│       ├── createdAt: timestamp
│       ├── updatedAt?: timestamp (if edited)
│       ├── isDeleted: boolean (soft delete)
│       ├── reactions: object
│       │   └── emoji → count
│       ├── sentiment?: "positive" | "neutral" | "negative"
│       ├── isFlagged: boolean (moderation)
│       └── flagReason?: string
│
├── bot_configs/
│   ├── discord
│   │   ├── enabled: boolean
│   │   ├── clientId: string
│   │   ├── botToken: string (encrypted)
│   │   ├── channelId: string
│   │   ├── targetRoomId: string
│   │   └── lastUpdated: timestamp
│   │
│   └── twitch
│       ├── enabled: boolean
│       ├── botUsername: string
│       ├── oauthToken: string (encrypted)
│       ├── channelName: string
│       ├── targetRoomId: string
│       └── lastUpdated: timestamp
│
├── analytics/
│   ├── daily/{date}
│   │   ├── date: string (YYYY-MM-DD)
│   │   ├── activeRooms: number
│   │   ├── activeUsers: number
│   │   ├── messagesCount: number
│   │   ├── songsPlayed: number
│   │   ├── avgSessionDuration: number
│   │   └── peakConcurrentUsers: number
│   │
│   └── room_stats/{roomId}
│       ├── roomId: string
│       ├── totalSessions: number
│       ├── totalMessages: number
│       ├── totalSongs: number
│       ├── avgSessionDuration: number
│       ├── createdAt: timestamp
│       └── lastUpdated: timestamp
│
└── audit_logs/
    └── {logId}
        ├── id: string
        ├── userId?: string
        ├── action: string (enum)
        ├── roomId?: string
        ├── details: object
        ├── timestamp: timestamp
        ├── ipAddress?: string
        └── userAgent?: string
```

---

## TypeScript Types

```typescript
// User Document
interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
  discordId?: string;
  twitchId?: string;
  preferences: {
    theme: "light" | "dark";
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

// Playlist Item
interface PlaylistItem {
  id: string;
  title: string;
  artist: string;
  url: string;
  duration: number;
  artId: string;
  addedBy: string;
  addedAt: Timestamp;
  plays: number;
  source: "web" | "discord" | "twitch";
}

// Room Document
interface Room {
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

// Room User (Participant)
interface RoomUser {
  uid: string;
  displayName: string;
  photoURL: string;
  joinedAt: Timestamp;
  leftAt?: Timestamp;
  connectionState: "connected" | "connecting" | "disconnected";
  isMuted: boolean;
  isSpeaking: boolean;
  metadata: {
    sessionDuration: number;
    messagesCount: number;
    lastMessageAt?: Timestamp;
  };
}

// Chat Message
interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  text: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  isDeleted: boolean;
  reactions: Record<string, number>;
  sentiment?: "positive" | "neutral" | "negative";
  isFlagged: boolean;
  flagReason?: string;
}

// Bot Config
interface BotConfig {
  enabled: boolean;
  targetRoomId: string;
  lastUpdated: Timestamp;
}

interface DiscordBotConfig extends BotConfig {
  clientId: string;
  botToken: string;
  channelId: string;
}

interface TwitchBotConfig extends BotConfig {
  botUsername: string;
  oauthToken: string;
  channelName: string;
}

// Analytics
interface DailyAnalytics {
  date: string;
  activeRooms: number;
  activeUsers: number;
  messagesCount: number;
  songsPlayed: number;
  avgSessionDuration: number;
  peakConcurrentUsers: number;
}

interface RoomStats {
  roomId: string;
  totalSessions: number;
  totalMessages: number;
  totalSongs: number;
  avgSessionDuration: number;
  createdAt: Timestamp;
  lastUpdated: Timestamp;
}

// Audit Log
interface AuditLog {
  id: string;
  userId?: string;
  action: string;
  roomId?: string;
  details: Record<string, any>;
  timestamp: Timestamp;
  ipAddress?: string;
  userAgent?: string;
}
```

---

## Firestore Security Rules

### Production Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // ===== HELPER FUNCTIONS =====
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
    
    // ===== USERS COLLECTION =====
    match /users/{userId} {
      // Users can read/write their own profile
      allow read: if isAuthenticated() && (isOwner(userId) || isPublic());
      allow write: if isOwner(userId);
      allow delete: if isOwner(userId);
      
      function isPublic() {
        return get(/databases/$(database)/documents/users/$(userId)).data.preferences.privateProfile == false;
      }
    }
    
    // ===== ROOMS COLLECTION =====
    match /rooms/{roomId} {
      // Authenticated users can read public rooms
      allow read: if isPublic(roomId) || (isAuthenticated() && isInRoom(roomId));
      
      // Only owner can write to room
      allow write: if isRoomOwner(roomId);
      
      // Only owner can delete room
      allow delete: if isRoomOwner(roomId);
      
      // Update playlist (DJ or owner only)
      allow update: if isAuthenticated() && (isDJ(roomId) || isRoomOwner(roomId)) &&
                       request.writeFields.hasOnly(['playlist', 'currentTrackId', 'isPlaying', 'playbackPosition', 'updatedAt']);
      
      // Update play state (DJ or owner only)
      allow update: if isAuthenticated() && (isDJ(roomId) || isRoomOwner(roomId)) &&
                       request.writeFields.hasOnly(['isPlaying', 'currentTrackId', 'playbackPosition', 'updatedAt']);
      
      // Update DJ status (owner only)
      allow update: if isRoomOwner(roomId) &&
                       request.writeFields.hasOnly(['djId', 'djDisplayName', 'djStartedAt', 'updatedAt']);
      
      // ===== ROOM USERS SUBCOLLECTION =====
      match /users/{userId} {
        // Users in room can read other room users
        allow read: if isInRoom(roomId);
        
        // Users can write their own room user doc
        allow write: if isAuthenticated() && isOwner(userId);
        
        // Owner can write room user docs
        allow write: if isRoomOwner(roomId);
      }
      
      // ===== ROOM MESSAGES SUBCOLLECTION =====
      match /messages/{messageId} {
        // Users in room can read messages
        allow read: if isInRoom(roomId);
        
        // Users in room can create messages
        allow create: if isInRoom(roomId) && 
                        request.auth.uid == request.resource.data.userId &&
                        request.resource.data.createdAt == request.time;
        
        // Users can edit/delete their own messages
        allow update, delete: if isAuthenticated() && 
                               request.auth.uid == resource.data.userId &&
                               (!request.resource.data.keys().hasAny(['userId', 'createdAt']));
        
        // Owner can delete any message
        allow delete: if isRoomOwner(roomId);
      }
    }
    
    // ===== BOT CONFIGS =====
    match /bot_configs/{config} {
      // Only admins can read/write (configure yourself)
      allow read, write: if isAuthenticated() && 
                           request.auth.uid in [
                             "admin_uid_1",
                             "admin_uid_2"
                           ];
    }
    
    // ===== ANALYTICS =====
    match /analytics/{documents=**} {
      // Only authenticated users can read
      allow read: if isAuthenticated();
      
      // Only backend can write (disable client writes)
      allow write: if false;
    }
    
    // ===== AUDIT LOGS =====
    match /audit_logs/{logId} {
      // Only authenticated users and backend can write
      allow write: if isAuthenticated() || request.auth == null;
      
      // Only admins and log author can read
      allow read: if isAuthenticated() && 
                     (request.auth.uid == resource.data.userId || 
                      request.auth.uid in ["admin_uid_1", "admin_uid_2"]);
    }
    
    // ===== DEFAULT DENY =====
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## Indexes Required

### Firestore Indexes (Composite)

```
Collection: rooms
Fields indexed:
  1. isPublic (Ascending) + createdAt (Descending)
  2. ownerId (Ascending) + createdAt (Descending)
  3. tags (Ascending) + isPublic (Ascending) + createdAt (Descending)

Collection: rooms/{roomId}/messages
Fields indexed:
  1. createdAt (Descending)
  2. userId (Ascending) + createdAt (Descending)
  3. isFlagged (Ascending) + createdAt (Descending)

Collection: analytics/daily
Fields indexed:
  1. date (Descending)

Collection: users
Fields indexed:
  1. createdAt (Descending)
  2. lastLoginAt (Descending)
```

**To create indexes in Firebase Console:**
1. Go to Firestore → Indexes → Composite
2. Create each composite index
3. Or let Firestore auto-suggest on first query

---

## Data Persistence Strategy

### What Gets Persisted

#### High Priority (Always Keep)
```
✅ User accounts & authentication
✅ Room metadata (name, owner, settings)
✅ Chat messages (indefinitely or archival)
✅ Playlist history (songs added to rooms)
✅ Room ownership & permissions
✅ Bot configuration
```

#### Medium Priority (Keep for Analytics)
```
✅ User stats (rooms created, songs requested)
✅ Room statistics (view count, total songs played)
✅ Audit logs (30-90 days minimum)
✅ Connection history (7-30 days)
```

#### Low Priority (Optional Cleanup)
```
⚠️ Temporary room participant data (cleanup after 30 days)
⚠️ Playback position (not needed after session ends)
⚠️ Transient connection states
```

### Data Retention Policies

```typescript
// Archive old data automatically using Cloud Functions

// After 30 days: Move old messages to archive collection
// After 90 days: Delete temporary connection logs
// After 1 year: Archive old analytics and keep summaries
// After 2 years: Delete audit logs

// Keep indefinitely:
// - User accounts
// - Room definitions
// - Room ownership history
// - Chat messages (for compliance)
```

---

## Backup & Recovery

### Automated Backup Strategy

```bash
# Daily automated backups via Google Cloud
# Location: gs://your-backup-bucket/

# Backup Schedule:
# Daily: 2:00 AM UTC
# Weekly: Full backup Sunday midnight UTC
# Retention: 30 days rolling
```

### Manual Backup Commands

```bash
# Export entire Firestore
gcloud firestore export gs://my-bucket/firestore-backup-$(date +%Y%m%d)

# Export specific collection
gcloud firestore export gs://my-bucket/rooms-backup --collection-ids=rooms

# Export with filters
gcloud firestore export gs://my-bucket/rooms-backup \
  --collection-ids=rooms,users
```

### Restore Procedures

```bash
# List available backups
gsutil ls gs://my-bucket/

# Restore entire database
gcloud firestore import gs://my-bucket/firestore-backup-20240128/

# Restore specific collection
# (Requires manual merge or selective restore)
```

---

## Migration Guide

### From Development to Production

#### Step 1: Prepare Production Database

```bash
# 1. Create new Firebase project for production
# 2. Deploy security rules
gcloud firestore deploy-rules firestore.rules

# 3. Create required indexes
# 4. Set up backup bucket
gsutil mb gs://my-production-backups
```

#### Step 2: Export Development Data

```bash
# Export development Firestore
gcloud firestore export gs://my-bucket/dev-export-$(date +%Y%m%d)

# OR use Firebase Console → Export
# Go to: Firestore → Backups → Export
```

#### Step 3: Clean & Transform Data

```typescript
// Use migration script to:
// 1. Remove test data
// 2. Encrypt sensitive fields
// 3. Add required fields
// 4. Fix any inconsistencies

const migrateData = async () => {
  // Remove test users
  const testUsers = await db.collection('users')
    .where('email', '==', 'test@example.com')
    .get();
  
  for (const doc of testUsers.docs) {
    await doc.ref.delete();
  }
  
  // Add missing timestamps
  const roomsWithoutUpdatedAt = await db.collection('rooms')
    .where('updatedAt', '==', null)
    .get();
  
  for (const doc of roomsWithoutUpdatedAt.docs) {
    await doc.ref.update({
      updatedAt: FieldValue.serverTimestamp()
    });
  }
  
  // Encrypt bot tokens
  const botConfigs = await db.collection('bot_configs').get();
  for (const doc of botConfigs.docs) {
    const encrypted = encryptToken(doc.data().botToken);
    await doc.ref.update({
      botToken: encrypted
    });
  }
};
```

#### Step 4: Import to Production

```bash
# Import cleaned data
gcloud firestore import gs://my-bucket/dev-export-cleaned/

# OR use Firebase Console import
```

#### Step 5: Verify Data Integrity

```typescript
// Verification checks
const verifyMigration = async () => {
  const usersCount = (await db.collection('users').count().get()).data().count;
  const roomsCount = (await db.collection('rooms').count().get()).data().count;
  const messagesCount = (await db.collectionGroup('messages').count().get()).data().count;
  
  console.log(`Users: ${usersCount}`);
  console.log(`Rooms: ${roomsCount}`);
  console.log(`Messages: ${messagesCount}`);
  
  // Check for data integrity
  const roomsWithoutOwner = await db.collection('rooms')
    .where('ownerId', '==', '')
    .count()
    .get();
  
  if (roomsWithoutOwner.data().count > 0) {
    throw new Error('Found rooms without owner!');
  }
};
```

---

## Implementation Checklist

### Database Setup

- [ ] Create Firestore database in production project
- [ ] Enable Firestore backups
- [ ] Set up backup storage bucket
- [ ] Deploy security rules
- [ ] Create composite indexes
- [ ] Enable audit logging

### Data Migration

- [ ] Export development data
- [ ] Clean test/development data
- [ ] Transform data to schema
- [ ] Encrypt sensitive fields
- [ ] Import to production
- [ ] Verify data integrity
- [ ] Test all queries work
- [ ] Monitor for errors (24 hours)

### Monitoring & Maintenance

- [ ] Set up automated daily backups
- [ ] Configure data expiration policies
- [ ] Set up database monitoring alerts
- [ ] Create runbooks for common procedures
- [ ] Document admin procedures
- [ ] Test disaster recovery procedure quarterly

### Security

- [ ] Verify security rules are enforced
- [ ] Test permission checks
- [ ] Audit sensitive data access
- [ ] Enable Firestore audit logging
- [ ] Set up DLP (Data Loss Prevention) if needed
- [ ] Configure API access controls

---

## Cost Optimization

### Estimated Monthly Costs

```
Small deployment (10 rooms, 50 users):
- Read operations: ~10,000-50,000/month = $0.06-0.30
- Write operations: ~5,000-20,000/month = $0.03-0.12
- Delete operations: ~1,000-5,000/month = $0.01-0.03
- Storage: ~100 MB = $0.18/month
Total: ~$0.28-0.63/month ✅ (Very cheap)

Medium deployment (50 rooms, 500 users):
- Read operations: ~100,000-500,000/month = $0.60-3.00
- Write operations: ~50,000-200,000/month = $0.30-1.20
- Delete operations: ~10,000-50,000/month = $0.06-0.30
- Storage: ~1 GB = $1.80/month
Total: ~$2.76-6.30/month ✅

Large deployment (200+ rooms, 2000+ users):
- Consider custom pricing
```

### Cost Reduction Strategies

1. **Batch operations** instead of single writes
2. **Index judiciously** - only needed indexes
3. **Archive old data** - move to Cloud Storage
4. **Cache frequently accessed data** - Redis/Memcache
5. **Use collection groups sparingly** - can be expensive

---

## Monitoring & Alerts

### Key Metrics to Monitor

```
1. Document read/write/delete counts
2. Storage size growth
3. Query latency (p50, p95, p99)
4. Firestore errors & exceptions
5. Security rule denials
6. Backup completion status
```

### Set up Alerts For

```
- Storage exceeds quota
- Spike in read/write operations (possible attack)
- Security rule denials (misconfiguration)
- Backup failures
- Query latency > 1 second
- Database errors > threshold
```

---

## Compliance & Privacy

### GDPR Compliance

```
✅ Data retention policies (auto-delete after period)
✅ User data export capability
✅ Right to be forgotten (delete user data)
✅ Audit logging of access
✅ Encryption at rest & in transit
✅ Privacy policy references
```

### Data Protection

```
✅ Encrypt sensitive fields (passwords, tokens)
✅ Hash PII before logging
✅ Restrict admin access to sensitive collections
✅ Enable audit logging
✅ Regular security audits
✅ Penetration testing
```

---

## Disaster Recovery Plan

### RPO & RTO Targets

```
RPO (Recovery Point Objective): 1 day
RTO (Recovery Time Objective): 4 hours

Meaning:
- Maximum data loss: 1 day
- Maximum downtime: 4 hours
```

### Recovery Procedures

```
Scenario 1: Accidental data deletion
1. Check Firestore backups
2. List available snapshots
3. Import previous backup
4. Verify data integrity
5. Bring system back online

Scenario 2: Database corruption
1. Stop all writes
2. Export current state
3. Restore from last known good backup
4. Run data validation
5. Resume operations

Scenario 3: Security breach
1. Disable all access
2. Rotate credentials
3. Update security rules
4. Audit all recent changes
5. Review access logs
6. Notify users if needed
7. Re-enable with new rules
```

---

## Next Steps

1. ✅ Review this schema with your team
2. ✅ Deploy security rules to development
3. ✅ Create required Firestore indexes
4. ✅ Set up automated backups
5. ✅ Test data export/import process
6. ✅ Create monitoring dashboards
7. ✅ Document your admin procedures
8. ✅ Deploy to production with confidence

---

**Your app is now ready for production with complete data persistence! 🚀**
