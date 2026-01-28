# Deployment Guide - HearMeOut to Firebase App Hosting

## Pre-Deployment Checklist

- [x] Voice chat working locally (LiveKit configured)
- [x] Discord OAuth implemented
- [x] Twitch OAuth implemented
- [ ] All secrets created in Google Secret Manager
- [ ] Service account permissions configured
- [ ] Production URLs configured
- [ ] Environment variables set in apphosting.yaml

## Step 1: Create Google Cloud Secrets

You need to create 7 secrets in Google Secret Manager:

```bash
# Set your Google Cloud project
gcloud config set project YOUR_PROJECT_ID

# Create secrets (choose one method):

# Method A: Interactive script (recommended)
bash create-secrets.sh

# Method B: Manual commands
gcloud secrets create livekit-api-key --replication-policy="automatic" --data-file=- <<< "YOUR_API_KEY"
gcloud secrets create livekit-api-secret --replication-policy="automatic" --data-file=- <<< "YOUR_API_SECRET"
gcloud secrets create livekit-url --replication-policy="automatic" --data-file=- <<< "https://your-livekit.example.com"
gcloud secrets create discord-client-id --replication-policy="automatic" --data-file=- <<< "YOUR_DISCORD_CLIENT_ID"
gcloud secrets create discord-client-secret --replication-policy="automatic" --data-file=- <<< "YOUR_DISCORD_SECRET"
gcloud secrets create twitch-client-id --replication-policy="automatic" --data-file=- <<< "YOUR_TWITCH_CLIENT_ID"
gcloud secrets create twitch-client-secret --replication-policy="automatic" --data-file=- <<< "YOUR_TWITCH_SECRET"
```

## Step 2: Verify Secrets Created

```bash
gcloud secrets list
```

You should see all 7 secrets listed.

## Step 3: Grant Service Account Access

Firebase App Hosting uses a service account to access secrets. Grant it access:

```bash
# Get your project number
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')

# Grant the service account access to all secrets
for secret in livekit-api-key livekit-api-secret livekit-url discord-client-id discord-client-secret twitch-client-id twitch-client-secret; do
    gcloud secrets add-iam-policy-binding $secret \
        --member=serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-firebase-apphosting.iam.gserviceaccount.com \
        --role=roles/secretmanager.secretAccessor
done
```

## Step 4: Update Production URLs

Edit `apphosting.yaml` and update:

```yaml
env:
  NODE_ENV: production
  NEXT_PUBLIC_BASE_URL: https://your-domain.web.app  # Change this to your actual domain
```

## Step 5: Update .env.local for Local Development

Create/update `.env.local` with local values:

```bash
# These are used in local development only
NEXT_PUBLIC_LIVEKIT_URL=https://your-dev-livekit.example.com
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

## Step 6: Deploy

```bash
# Log in to Firebase
firebase login

# Deploy to Firebase App Hosting
firebase deploy

# Or deploy just the backend:
firebase deploy --only=apphosting
```

## Step 7: Verify Deployment

1. Check deployment status in Firebase Console
2. Visit your app URL
3. Test voice chat connection
4. Test Discord OAuth login
5. Test Twitch OAuth login

## Environment Variables Reference

### Runtime Secrets (from Secret Manager)
- `LIVEKIT_API_KEY` - LiveKit API key for generating tokens
- `LIVEKIT_API_SECRET` - LiveKit API secret for token generation
- `NEXT_PUBLIC_LIVEKIT_URL` - LiveKit server URL
- `NEXT_PUBLIC_DISCORD_CLIENT_ID` - Discord OAuth app client ID
- `DISCORD_CLIENT_SECRET` - Discord OAuth app secret
- `NEXT_PUBLIC_TWITCH_CLIENT_ID` - Twitch OAuth app client ID
- `TWITCH_CLIENT_SECRET` - Twitch OAuth app secret

### Static Variables (in apphosting.yaml)
- `NODE_ENV` - Set to 'production'
- `NEXT_PUBLIC_BASE_URL` - Your production domain

### Firebase Variables (embedded in code - not needed)
- Firebase config is built into the client code
- No server-side Firebase secrets needed

## Troubleshooting

### Secrets not found in production
1. Verify secrets exist: `gcloud secrets list`
2. Check service account permissions: `gcloud secrets get-iam-policy SECRET_NAME`
3. Check apphosting.yaml spelling matches secret names exactly
4. Check Firebase logs: `firebase functions:log`

### Voice chat not working
1. Verify `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are set
2. Verify `NEXT_PUBLIC_LIVEKIT_URL` is correct and accessible
3. Check browser console for error messages

### OAuth not working
1. Verify client IDs and secrets match Discord/Twitch settings
2. Update OAuth redirect URLs in Discord/Twitch consoles to production domain
3. Check browser console for auth errors

## Rollback

If something goes wrong:

```bash
# Rollback to previous deployment
firebase hosting:versions:list
firebase hosting:rollback VERSION_ID
```

## Next Steps

- Monitor logs: `firebase functions:log`
- Set up continuous deployment with GitHub Actions
- Configure custom domain
- Set up monitoring and alerts
