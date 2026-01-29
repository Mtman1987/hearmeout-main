# Firestore Backup Configuration

## Automated Daily Backups

### Using Firebase CLI

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Export Firestore to Cloud Storage
firebase firestore:export gs://YOUR_BUCKET_NAME/backups/$(date +%Y%m%d)
```

### Using Cloud Scheduler (Recommended for Production)

1. **Create Cloud Storage Bucket**
```bash
gsutil mb gs://hearmeout-backups
```

2. **Set up Cloud Scheduler Job**
```bash
gcloud scheduler jobs create http firestore-backup \
  --schedule="0 2 * * *" \
  --uri="https://firestore.googleapis.com/v1/projects/YOUR_PROJECT_ID/databases/(default):exportDocuments" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"outputUriPrefix":"gs://hearmeout-backups/daily"}' \
  --oauth-service-account-email=YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

3. **Grant Permissions**
```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member=serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/datastore.importExportAdmin
```

### Manual Backup

```bash
# Export entire database
gcloud firestore export gs://hearmeout-backups/manual-$(date +%Y%m%d)

# Export specific collections
gcloud firestore export gs://hearmeout-backups/rooms-$(date +%Y%m%d) \
  --collection-ids=rooms,users
```

### Restore from Backup

```bash
# List backups
gsutil ls gs://hearmeout-backups/

# Restore
gcloud firestore import gs://hearmeout-backups/daily/TIMESTAMP/
```

## Backup Retention

- Daily backups: Keep 30 days
- Weekly backups: Keep 12 weeks
- Monthly backups: Keep 12 months

Set lifecycle policy:
```bash
gsutil lifecycle set backup-lifecycle.json gs://hearmeout-backups
```

backup-lifecycle.json:
```json
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 30}
      }
    ]
  }
}
```

## Monitoring

Check backup status:
```bash
gcloud scheduler jobs describe firestore-backup
```

View logs:
```bash
gcloud logging read "resource.type=cloud_scheduler_job AND resource.labels.job_id=firestore-backup" --limit 50
```
