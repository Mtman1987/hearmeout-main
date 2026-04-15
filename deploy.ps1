# HearMeOut Deployment Script
# Run this from the hearmeout-main directory

Write-Host "🎵 Deploying HearMeOut..." -ForegroundColor Cyan

# Set environment variable for Windows
$env:NODE_ENV = "production"

# Build the application
Write-Host "📦 Building application..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}

# Deploy to Fly.io
Write-Host "🛫 Deploying to Fly.io..." -ForegroundColor Yellow
fly deploy

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ HearMeOut deployed successfully!" -ForegroundColor Green
    Write-Host "🎧 Your Discord Activity is live!" -ForegroundColor Cyan
} else {
    Write-Host "❌ Deployment failed!" -ForegroundColor Red
    exit 1
}