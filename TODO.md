# TODO: Remaining Work

## Popout Widgets

### Completed ✅
- [x] PopoutProvider context
- [x] DraggableContainer component
- [x] VoiceRoomWidget component
- [x] ChatWidget component
- [x] PopoutRenderer component
- [x] Discord/Twitch chat services (placeholder)
- [x] Type definitions
- [x] Integration in layout and room page

### Phase 2: Real Data Integration ✅
- [x] Connect Discord API for real channel list
- [x] Connect Discord API for real messages
- [x] Connect Twitch iframe embed for live chat
- [x] Implement message sending

### Phase 3: Polish & Features ✅
- [x] LocalStorage persistence for widget positions
- [x] Widget-only mode URLs for OBS
- [x] OBS integration documentation
- [ ] Custom themes for widgets (optional)
- [ ] Opacity controls for overlays (optional - available via URL param)

## Database & Infrastructure

### Completed ✅
- [x] Centralized Firestore service layer
- [x] Updated bot-actions to use service layer
- [x] Created real-time hooks (use-room.ts)
- [x] Created logger utility
- [x] Created health check endpoint
- [x] Backup documentation (BACKUP_SETUP.md)
- [x] Monitoring documentation (MONITORING_SETUP.md)

### Production Ready
- [ ] Follow BACKUP_SETUP.md to configure automated backups
- [ ] Follow MONITORING_SETUP.md to configure alerts

### Later (Not Blocking)
- [ ] Deploy production security rules
- [ ] Create Firestore indexes (auto-suggested when needed)
- [ ] Implement analytics collection
- [ ] Add audit logging
- [ ] Data retention policies
- [ ] GDPR compliance features

## Audio & WebRTC

### Completed ✅
- [x] CORS & Piped instance handling
- [x] Retry mechanism with exponential backoff
- [x] Audio error state tracking
- [x] Web Audio API implementation
- [x] Music streaming via LiveKit
- [x] Voice chat via LiveKit

### Future Enhancements
- [ ] Cache resolved audio URLs
- [ ] Synchronized playback across users
- [ ] Audio quality selection
- [ ] Audio visualization
