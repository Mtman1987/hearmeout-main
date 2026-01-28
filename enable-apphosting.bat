@echo off
REM Enable Firebase App Hosting and set up permissions

echo Enabling Firebase App Hosting API...
gcloud services enable apphosting.googleapis.com --project=studio-4331919473-dea24
echo.

echo Enabling Cloud Build API...
gcloud services enable cloudbuild.googleapis.com --project=studio-4331919473-dea24
echo.

echo Waiting 30 seconds for service account to be created...
timeout /t 30 /nobreak
echo.

echo Granting permissions to Firebase service account...
echo.

gcloud secrets add-iam-policy-binding livekit-api-key --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding livekit-api-secret --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding livekit-url --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding discord-client-id --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding discord-client-secret --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding twitch-client-id --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding twitch-client-secret --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor

echo.
echo ======================================
echo Done!
echo ======================================
pause
