# Monitoring & Alerts Setup

## Firebase Console Monitoring

### 1. Firestore Usage
- Go to Firebase Console → Firestore → Usage
- Monitor:
  - Document reads/writes/deletes
  - Storage size
  - Network egress

### 2. Authentication
- Go to Firebase Console → Authentication → Usage
- Monitor:
  - Active users
  - Sign-in methods usage

### 3. Hosting/App Hosting
- Go to Firebase Console → Hosting → Usage
- Monitor:
  - Bandwidth
  - Storage
  - Requests

## Cloud Monitoring (Google Cloud Console)

### Set Up Alerts

1. **Go to Cloud Console → Monitoring → Alerting**

2. **Create Alert Policies:**

#### High Firestore Read Operations
```
Metric: firestore.googleapis.com/document/read_count
Condition: Rate > 10000 per minute
Notification: Email/SMS
```

#### High Error Rate
```
Metric: logging.googleapis.com/user/error_count
Condition: Count > 100 per 5 minutes
Notification: Email/SMS
```

#### Storage Quota Warning
```
Metric: firestore.googleapis.com/storage/size
Condition: > 80% of quota
Notification: Email
```

### Dashboard Setup

Create custom dashboard:
```
1. Go to Monitoring → Dashboards → Create Dashboard
2. Add charts:
   - Firestore operations (line chart)
   - Active users (gauge)
   - Error rate (line chart)
   - Response time (heatmap)
```

## Application Logging

### Add to your app:

```typescript
// src/lib/logger.ts
export const logger = {
  info: (message: string, data?: any) => {
    console.log(`[INFO] ${message}`, data);
  },
  error: (message: string, error?: any) => {
    console.error(`[ERROR] ${message}`, error);
  },
  warn: (message: string, data?: any) => {
    console.warn(`[WARN] ${message}`, data);
  },
};
```

### Key Metrics to Log

- Room creation/deletion
- User authentication
- Bot command execution
- Audio streaming errors
- API failures

## Health Check Endpoint

Create `src/app/api/health/route.ts`:
```typescript
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}
```

Monitor with external service (UptimeRobot, Pingdom, etc.)

## Error Tracking

### Option 1: Sentry (Recommended)
```bash
npm install @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
```

### Option 2: Firebase Crashlytics
Already included with Firebase SDK

## Performance Monitoring

### Firebase Performance Monitoring
```typescript
import { getPerformance } from 'firebase/performance';

const perf = getPerformance(app);
```

### Web Vitals
Already tracked by Next.js

## Alert Channels

Set up notifications:
- Email: team@example.com
- SMS: For critical alerts
- Slack: #alerts channel
- PagerDuty: For on-call rotation

## Monitoring Checklist

- [ ] Set up Firestore usage alerts
- [ ] Set up error rate alerts
- [ ] Set up storage quota alerts
- [ ] Create monitoring dashboard
- [ ] Configure backup monitoring
- [ ] Set up health check endpoint
- [ ] Configure external uptime monitoring
- [ ] Set up error tracking (Sentry)
- [ ] Configure notification channels
- [ ] Test alert delivery
