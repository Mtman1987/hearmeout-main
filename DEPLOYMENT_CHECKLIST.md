# Production Deployment Checklist

Complete checklist to deploy HearMeOut with full production database support.

---

## Pre-Deployment (1-2 weeks before)

### Database Planning
- [ ] Review PRODUCTION_DATABASE_STRUCTURE.md
- [ ] Review DATABASE_IMPLEMENTATION_GUIDE.md
- [ ] Identify all data types currently in use
- [ ] Plan data retention policies
- [ ] Calculate estimated costs on Firebase
- [ ] Set up staging Firebase project for testing

### Code Preparation
- [ ] Create `src/firebase/firestore-service.ts` with all service functions
- [ ] Update type definitions in `src/types/index.ts`
- [ ] Create migration script in `scripts/migrate-firestore.ts`
- [ ] Update existing components to use service layer
- [ ] Test all database operations locally
- [ ] Run TypeScript compiler check: `tsc --noEmit`

### Security Planning
- [ ] Review firestore.rules for your use cases
- [ ] Customize admin UIDs in security rules
- [ ] Plan encryption for sensitive data (bot tokens)
- [ ] Review user data privacy requirements
- [ ] Determine GDPR/compliance requirements

### Infrastructure Setup
- [ ] Create production Firebase project
- [ ] Enable Firestore in production project
- [ ] Create Cloud Storage bucket for backups
- [ ] Configure Firebase authentication methods
- [ ] Set up billing alerts
- [ ] Configure backup retention (30 days minimum)

---

## 1 Week Before Deployment

### Testing Phase

#### Database Operations
- [ ] Test `userService.createUser()`
- [ ] Test `roomService.createRoom()`
- [ ] Test `roomService.addSongToPlaylist()`
- [ ] Test `messageService.addMessage()`
- [ ] Test `roomUserService.addUserToRoom()`
- [ ] Test all update operations
- [ ] Test batch operations
- [ ] Test delete operations
- [ ] Test error handling

#### Real-time Listeners
- [ ] Test room real-time listener
- [ ] Test messages real-time listener
- [ ] Test room users listener
- [ ] Verify data updates propagate instantly
- [ ] Test listener cleanup on unmount

#### Security Rules
- [ ] Deploy rules to staging environment
- [ ] Test authenticated user access
- [ ] Test public room access
- [ ] Test private room access (should deny)
- [ ] Test DJ-only operations
- [ ] Test message deletion by author
- [ ] Test message deletion by room owner
- [ ] Test room owner operations only
- [ ] Verify bot token access is denied

#### Integration Testing
- [ ] Test Discord song request (end-to-end)
- [ ] Test Twitch !sr command (end-to-end)
- [ ] Test Play/Pause button
- [ ] Test Skip button
- [ ] Test real-time sync across platforms
- [ ] Test chat message sync
- [ ] Test user presence tracking

#### Load Testing
- [ ] Simulate 10 concurrent users in room
- [ ] Add 100 songs to playlist
- [ ] Send 1000 messages in rapid succession
- [ ] Monitor database performance
- [ ] Check for timeout issues
- [ ] Verify cost estimates are accurate

### Documentation

- [ ] Review all documentation files
- [ ] Create runbook for common operations
- [ ] Document admin procedures
- [ ] Create disaster recovery guide
- [ ] Document backup/restore procedures
- [ ] Create troubleshooting guide for common issues
- [ ] Document all environment variables needed

### Team Training

- [ ] Train team on new service layer
- [ ] Review security rules with team
- [ ] Practice disaster recovery procedure
- [ ] Review monitoring and alerting
- [ ] Create on-call runbook
- [ ] Define escalation procedures

---

## 3 Days Before Deployment

### Final Preparation

#### Environment Setup
- [ ] Copy `.env.local` to `.env.production`
- [ ] Update Firebase config for production project
- [ ] Update Discord bot token for production
- [ ] Update Twitch bot token for production
- [ ] Verify all API endpoints are production-ready
- [ ] Set up production database backups

#### Code Verification
- [ ] Run `npm run build` successfully
- [ ] Run linter: `npm run lint` (0 errors)
- [ ] Run TypeScript: `tsc --noEmit` (0 errors)
- [ ] Review all console.error() for production readiness
- [ ] Remove all `console.log()` statements (except errors)
- [ ] Verify error messages are user-friendly
- [ ] Test all error recovery paths

#### Final Testing
- [ ] Smoke test entire app flow
- [ ] Test all bot integrations
- [ ] Verify real-time sync works
- [ ] Test error scenarios
- [ ] Verify database backups work
- [ ] Test restore from backup

#### Performance Checklist
- [ ] Lighthouse score > 80
- [ ] Database queries < 100ms (p95)
- [ ] Message broadcast < 500ms
- [ ] Page load time < 3s
- [ ] Real-time updates < 1s
- [ ] Verify CDN configured

---

## Deployment Day

### 2 Hours Before

- [ ] Alert all users of upcoming maintenance window
- [ ] Stop accepting new requests (optional graceful shutdown)
- [ ] Create full database backup manually
- [ ] Verify backup completed successfully
- [ ] Export data locally as safety measure
- [ ] Have rollback plan ready
- [ ] Assemble deployment team (at least 2 people)

### Deployment Steps

#### Step 1: Deploy Security Rules
```bash
firebase use production
firebase deploy --only firestore:rules --force
# Verify: Check Firestore Console → Rules
# ✓ Rules deployed timestamp visible
# ✓ Rules playground accessible
```
**Estimated time: 2 minutes**
**Risk level: MEDIUM (can break access)**
**Rollback: Redeploy previous rules from git**

#### Step 2: Create Firestore Indexes
```bash
# Verify indexes in Firestore Console:
# ✓ rooms: isPublic + createdAt
# ✓ rooms: ownerId + createdAt
# ✓ rooms: tags + isPublic + createdAt
# ✓ rooms/{id}/messages: createdAt
# ✓ rooms/{id}/messages: userId + createdAt
# ✓ rooms/{id}/messages: isFlagged + createdAt

# If missing, create in Firebase Console
# Firestore → Indexes → Create composite index
```
**Estimated time: 5-30 minutes**
**Note: Indexes build in background, queries may be slow initially**

#### Step 3: Deploy Application Code
```bash
npm run build
firebase deploy --only hosting --force
# Verify: Check Firebase Console → Hosting
# ✓ New deployment shows in history
# ✓ "Deployed" status visible
# ✓ Can preview new version
```
**Estimated time: 5-10 minutes**
**Risk level: LOW (can rollback immediately)**

#### Step 4: Migrate Data (if needed)
```bash
# Only if migrating from old database structure
npx ts-node scripts/migrate-firestore.ts
# Verify: Check Firestore Console for new structure
# ✓ All collections present
# ✓ Required fields populated
# ✓ No errors in console
```
**Estimated time: Varies (5 min - 1 hour depending on data)**
**Rollback: Restore from pre-migration backup**

#### Step 5: Verify Production
```bash
# Test in production
curl https://yourdomain.com/api/health  # Should return 200

# Manual testing
# 1. Create a new room
# 2. Add a song
# 3. Send a chat message
# 4. Verify in Firestore Console
# 5. Test Discord song request
# 6. Test Twitch !sr command
# 7. Test Play/Pause button
# 8. Test Skip button
```
**Estimated time: 10 minutes**
**Risk level: HIGH (could uncover issues)**

#### Step 6: Enable Traffic
```bash
# If you used graceful shutdown:
# 1. Restore to accepting requests
# 2. Gradually increase traffic (if using load balancer)
# 3. Monitor error rates
# 4. Verify database latency
```
**Estimated time: 5 minutes**

### Post-Deployment (1 hour)

- [ ] Monitor database for errors
- [ ] Monitor API latency
- [ ] Check error logs (Firebase → Functions)
- [ ] Verify backups completed
- [ ] Test all features one more time
- [ ] Check real-time sync working
- [ ] Verify bots are operational
- [ ] Monitor cost/usage

### Post-Deployment (24 hours)

- [ ] Review error logs for any issues
- [ ] Verify no users have reported problems
- [ ] Check database growth is as expected
- [ ] Verify backup schedule running
- [ ] Review analytics data
- [ ] Update status page
- [ ] Notify team deployment successful
- [ ] Schedule retrospective if any issues

---

## Rollback Procedure

### If Something Goes Wrong

**Option 1: Rollback Code (Fastest)**
```bash
# Revert to previous hosting version
firebase hosting:rollback

# Verify: Check Firebase Console → Hosting
# Should show previous version as active
```
**Time: 1-2 minutes**
**Impact: Serves old code, database changes remain**

**Option 2: Rollback Security Rules**
```bash
# Get previous rules from git
git show HEAD~1:firestore.rules > firestore.rules

# Deploy previous rules
firebase deploy --only firestore:rules --force

# Verify in Firestore Console
```
**Time: 2-5 minutes**
**Impact: Restores previous access patterns**

**Option 3: Restore Database Backup**
```bash
# List available backups
gsutil ls gs://your-backup-bucket/

# Restore from specific backup
gcloud firestore import gs://your-backup-bucket/firestore-backup-20240128/

# Verify data is restored
```
**Time: 30 minutes - 2 hours**
**Impact: Loses all data since backup**
**Use only if data corruption detected**

---

## Monitoring & Alerting

### Set Up Cloud Monitoring

1. **Go to:** Google Cloud Console → Monitoring
2. **Create alerts for:**

```
Alert: Database Reads Spike
- Metric: Firestore Operations (Read)
- Threshold: > 50,000 per minute
- Notification: Email + Slack

Alert: Database Writes Spike
- Metric: Firestore Operations (Write)
- Threshold: > 10,000 per minute
- Notification: Email + Slack

Alert: Storage Growth
- Metric: Firestore Storage
- Threshold: > 80% of quota
- Notification: Email

Alert: API Errors
- Metric: Cloud Functions Execution
- Status: Error
- Notification: Email + PagerDuty

Alert: Database Latency
- Metric: Firestore Operations
- p95 Latency: > 1000ms
- Notification: Slack
```

### Daily Monitoring

- [ ] Check error logs (Cloud Logging)
- [ ] Verify backup completed
- [ ] Review database metrics
- [ ] Check cost trends
- [ ] Monitor user reports
- [ ] Check bot status

---

## Success Criteria

Deployment is successful when:

✅ All user data persisted to Firestore
✅ Real-time listeners working (updates < 1s)
✅ Room creation works
✅ Song requests work from all sources
✅ Chat messages persisted
✅ Discord bot operational
✅ Twitch bot operational
✅ Play/Pause controls work
✅ Skip button works
✅ Security rules enforced
✅ No data loss
✅ No critical errors in logs
✅ Backups completing daily
✅ Users report normal behavior

---

## Post-Launch Tasks

### Week 1
- [ ] Monitor for any issues
- [ ] Respond to user feedback
- [ ] Check analytics and usage patterns
- [ ] Verify backup integrity
- [ ] Review cost metrics
- [ ] Optimize indexes if needed (based on real usage)

### Week 2-4
- [ ] Analyze usage patterns
- [ ] Optimize queries based on actual usage
- [ ] Implement caching if needed
- [ ] Archive old data if retention policy triggered
- [ ] Train support team
- [ ] Document any issues found

### Month 2+
- [ ] Schedule security audit
- [ ] Plan capacity planning (estimate 6-month growth)
- [ ] Implement additional monitoring
- [ ] Plan next feature releases
- [ ] Review and update disaster recovery procedures

---

## Emergency Contacts

**Database Issues:** Firebase Support (https://firebase.google.com/support)
**Discord Bot Issues:** Discord Developer Portal
**Twitch Bot Issues:** Twitch Developer Console
**Cloud Issues:** Google Cloud Support

---

## Common Issues & Solutions

### Issue: Security rules blocking access

**Solution:**
1. Check user is authenticated: `request.auth != null`
2. Check user is in room: `exists(/databases/$(database)/documents/rooms/$(roomId)/users/$(request.auth.uid))`
3. Test rules in Firestore Console → Rules Playground
4. Check user UID in Firestore Console

### Issue: Indexes not found

**Solution:**
1. Check Firestore Console → Indexes
2. Create missing composite indexes
3. Wait for index to build (usually < 10 minutes)
4. Don't run queries before index ready

### Issue: Database latency high

**Solution:**
1. Check if index exists for the query
2. Reduce query result set (add limits)
3. Use caching layer
4. Check for excessive real-time listeners
5. Archive old data

### Issue: Costs higher than expected

**Solution:**
1. Check what's consuming operations
2. Use Firebase CLI: `firebase debug firestore`
3. Reduce real-time listener count
4. Batch operations together
5. Implement caching

---

**You're ready to launch! 🚀**

Good luck with your deployment!
