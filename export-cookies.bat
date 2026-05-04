@echo off
echo === YouTube Cookie Export for HearMeOut ===
echo.
echo This exports your YouTube cookies so yt-dlp on Fly.io
echo can download songs without getting rate-limited.
echo.
echo Step 1: Export cookies using yt-dlp
echo.

yt-dlp --cookies-from-browser chrome --cookies youtube-cookies.txt --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

if not exist youtube-cookies.txt (
    echo.
    echo ERROR: Cookie export failed. Try with a different browser:
    echo   yt-dlp --cookies-from-browser firefox --cookies youtube-cookies.txt --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    echo   yt-dlp --cookies-from-browser edge --cookies youtube-cookies.txt --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    pause
    exit /b 1
)

echo.
echo Step 2: Uploading cookies to Fly.io...
echo.

REM Use fly ssh to copy the file
fly ssh sftp shell -a hmo-dj-worker -C "put youtube-cookies.txt /data/youtube-cookies.txt"

if %errorlevel% neq 0 (
    echo.
    echo Auto-upload failed. Try manually:
    echo   fly ssh console -a hmo-dj-worker -C "cat > /data/youtube-cookies.txt" < youtube-cookies.txt
    echo.
    echo Or use: fly proxy 10022:22 -a hmo-dj-worker
    echo Then:   scp -P 10022 youtube-cookies.txt root@localhost:/data/youtube-cookies.txt
)

echo.
echo Done! Restart the app: fly apps restart hmo-dj-worker
echo.
pause
