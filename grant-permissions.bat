@echo off
REM Grant Firebase service account access to all secrets

echo Granting permissions...
echo.

gcloud secrets add-iam-policy-binding livekit-api-key --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
echo.

gcloud secrets add-iam-policy-binding livekit-api-secret --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
echo.

gcloud secrets add-iam-policy-binding livekit-url --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
echo.

gcloud secrets add-iam-policy-binding discord-client-id --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
echo.

gcloud secrets add-iam-policy-binding discord-client-secret --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
echo.

gcloud secrets add-iam-policy-binding twitch-client-id --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
echo.

gcloud secrets add-iam-policy-binding twitch-client-secret --member=serviceAccount:service-1085802210092@gcp-sa-firebase-apphosting.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
echo.

echo ======================================
echo Done! All permissions granted.
echo ======================================
pause
