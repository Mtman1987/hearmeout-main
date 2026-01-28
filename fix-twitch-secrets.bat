@echo off
REM Fix Twitch secrets

for /f "tokens=*" %%i in ('gcloud config get-value project') do set PROJECT=%%i

echo Updating TWITCH_CLIENT_ID...
echo 9u0mtc83xeabmguw53c89dehth0gwg > "%TEMP%\secret.txt"
gcloud secrets versions add twitch-client-id --data-file="%TEMP%\secret.txt" --project=%PROJECT%
del /f /q "%TEMP%\secret.txt"
echo Updated twitch-client-id

echo.
echo Updating TWITCH_CLIENT_SECRET...
echo wclfm53vrx76i435p2jhmyv3v1ovrn > "%TEMP%\secret.txt"
gcloud secrets versions add twitch-client-secret --data-file="%TEMP%\secret.txt" --project=%PROJECT%
del /f /q "%TEMP%\secret.txt"
echo Updated twitch-client-secret

echo.
echo Done! Both Twitch secrets updated.
pause
