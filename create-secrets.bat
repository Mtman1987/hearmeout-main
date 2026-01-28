@echo off
setlocal enabledelayedexpansion

echo ======================================
echo HearMeOut - Google Secret Manager Setup
echo ======================================
echo.

REM Get project
for /f "tokens=*" %%i in ('gcloud config get-value project') do set PROJECT=%%i
echo Project: %PROJECT%
echo.

REM Secret 1
set /p VALUE="[1/7] LIVEKIT_API_KEY (from LiveKit dashboard): "
if not "!VALUE!"=="" (
    echo !VALUE! > "%TEMP%\secret.txt"
    gcloud secrets describe livekit-api-key --project=%PROJECT% >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        gcloud secrets versions add livekit-api-key --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Updated livekit-api-key
    ) else (
        gcloud secrets create livekit-api-key --replication-policy="automatic" --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Created livekit-api-key
    )
    del /f /q "%TEMP%\secret.txt"
) else echo Skipped
echo.

REM Secret 2
set /p VALUE="[2/7] LIVEKIT_API_SECRET (from LiveKit dashboard): "
if not "!VALUE!"=="" (
    echo !VALUE! > "%TEMP%\secret.txt"
    gcloud secrets describe livekit-api-secret --project=%PROJECT% >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        gcloud secrets versions add livekit-api-secret --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Updated livekit-api-secret
    ) else (
        gcloud secrets create livekit-api-secret --replication-policy="automatic" --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Created livekit-api-secret
    )
    del /f /q "%TEMP%\secret.txt"
) else echo Skipped
echo.

REM Secret 3
set /p VALUE="[3/7] NEXT_PUBLIC_LIVEKIT_URL (e.g., https://livekit.example.com): "
if not "!VALUE!"=="" (
    echo !VALUE! > "%TEMP%\secret.txt"
    gcloud secrets describe livekit-url --project=%PROJECT% >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        gcloud secrets versions add livekit-url --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Updated livekit-url
    ) else (
        gcloud secrets create livekit-url --replication-policy="automatic" --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Created livekit-url
    )
    del /f /q "%TEMP%\secret.txt"
) else echo Skipped
echo.

REM Secret 4
set /p VALUE="[4/7] NEXT_PUBLIC_DISCORD_CLIENT_ID (from Discord Developer Portal): "
if not "!VALUE!"=="" (
    echo !VALUE! > "%TEMP%\secret.txt"
    gcloud secrets describe discord-client-id --project=%PROJECT% >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        gcloud secrets versions add discord-client-id --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Updated discord-client-id
    ) else (
        gcloud secrets create discord-client-id --replication-policy="automatic" --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Created discord-client-id
    )
    del /f /q "%TEMP%\secret.txt"
) else echo Skipped
echo.

REM Secret 5
set /p VALUE="[5/7] DISCORD_CLIENT_SECRET (from Discord Developer Portal): "
if not "!VALUE!"=="" (
    echo !VALUE! > "%TEMP%\secret.txt"
    gcloud secrets describe discord-client-secret --project=%PROJECT% >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        gcloud secrets versions add discord-client-secret --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Updated discord-client-secret
    ) else (
        gcloud secrets create discord-client-secret --replication-policy="automatic" --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Created discord-client-secret
    )
    del /f /q "%TEMP%\secret.txt"
) else echo Skipped
echo.

REM Secret 6
set /p VALUE="[6/7] NEXT_PUBLIC_TWITCH_CLIENT_ID (from Twitch Developer Console): "
if not "!VALUE!"=="" (
    echo !VALUE! > "%TEMP%\secret.txt"
    gcloud secrets describe twitch-client-id --project=%PROJECT% >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        gcloud secrets versions add twitch-client-id --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Updated twitch-client-id
    ) else (
        gcloud secrets create twitch-client-id --replication-policy="automatic" --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Created twitch-client-id
    )
    del /f /q "%TEMP%\secret.txt"
) else echo Skipped
echo.

REM Secret 7
set /p VALUE="[7/7] TWITCH_CLIENT_SECRET (from Twitch Developer Console): "
if not "!VALUE!"=="" (
    echo !VALUE! > "%TEMP%\secret.txt"
    gcloud secrets describe twitch-client-secret --project=%PROJECT% >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        gcloud secrets versions add twitch-client-secret --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Updated twitch-client-secret
    ) else (
        gcloud secrets create twitch-client-secret --replication-policy="automatic" --data-file="%TEMP%\secret.txt" --project=%PROJECT%
        echo Created twitch-client-secret
    )
    del /f /q "%TEMP%\secret.txt"
) else echo Skipped
echo.

echo ======================================
echo Verifying secrets...
echo ======================================
gcloud secrets list --project=%PROJECT%

echo.
echo ======================================
echo Done!
echo ======================================
echo.
echo Next: Grant permissions to Firebase service account
echo.
pause
