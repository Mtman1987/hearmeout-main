# Create Google Cloud Secrets for HearMeOut Deployment
# PowerShell version for Windows

Write-Host "======================================"
Write-Host "HearMeOut - Google Secret Manager Setup"
Write-Host "======================================"
Write-Host ""

# Check if gcloud is available
$gcloudCheck = gcloud --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: gcloud CLI not found. Please install Google Cloud SDK first." -ForegroundColor Red
    Write-Host "Download from: https://cloud.google.com/sdk/docs/install-sdk#windows"
    exit 1
}

Write-Host "✓ Google Cloud SDK found" -ForegroundColor Green
Write-Host ""

# Get current project
$project = gcloud config get-value project 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: No project set. Run: gcloud config set project YOUR_PROJECT_ID" -ForegroundColor Red
    exit 1
}

Write-Host "Project: $project" -ForegroundColor Cyan
Write-Host ""
Write-Host "You will be prompted for each of the 7 secrets needed for deployment:" -ForegroundColor Yellow
Write-Host ""

# Array of secrets to create
$secrets = @(
    @{
        name = "livekit-api-key"
        prompt = "LIVEKIT_API_KEY (from LiveKit dashboard)"
        description = "LiveKit API Key"
    },
    @{
        name = "livekit-api-secret"
        prompt = "LIVEKIT_API_SECRET (from LiveKit dashboard)"
        description = "LiveKit API Secret"
    },
    @{
        name = "livekit-url"
        prompt = "NEXT_PUBLIC_LIVEKIT_URL (e.g., https://livekit.example.com)"
        description = "LiveKit Server URL"
    },
    @{
        name = "discord-client-id"
        prompt = "NEXT_PUBLIC_DISCORD_CLIENT_ID (from Discord Developer Portal)"
        description = "Discord Client ID"
    },
    @{
        name = "discord-client-secret"
        prompt = "DISCORD_CLIENT_SECRET (from Discord Developer Portal)"
        description = "Discord Client Secret"
    },
    @{
        name = "twitch-client-id"
        prompt = "NEXT_PUBLIC_TWITCH_CLIENT_ID (from Twitch Developer Console)"
        description = "Twitch Client ID"
    },
    @{
        name = "twitch-client-secret"
        prompt = "TWITCH_CLIENT_SECRET (from Twitch Developer Console)"
        description = "Twitch Client Secret"
    }
)

$createdCount = 0
$skippedCount = 0

# Create each secret
foreach ($secret in $secrets) {
    Write-Host "[$($createdCount + $skippedCount + 1)/$($secrets.Count)] $($secret.description)" -ForegroundColor Cyan
    
    # Get value from user
    $value = Read-Host -Prompt $secret.prompt
    
    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Host "  ⊘ Skipped (empty value)" -ForegroundColor Yellow
        $skippedCount++
        Write-Host ""
        continue
    }
    
    # Create or update secret using temp file
    Write-Host "  Creating secret: $($secret.name)..." -ForegroundColor Gray
    
    # Create temp file with secret value
    $tempFile = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $tempFile -Value $value -NoNewline
    
    try {
        # First check if secret exists
        $secretExists = gcloud secrets describe $secret.name --project=$project 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            # Secret exists, add new version
            gcloud secrets versions add $secret.name --data-file=$tempFile --project=$project 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  ✓ Updated" -ForegroundColor Green
                $createdCount++
            } else {
                Write-Host "  ✗ Failed to update" -ForegroundColor Red
            }
        } else {
            # Secret doesn't exist, create it
            gcloud secrets create $secret.name --replication-policy="automatic" --data-file=$tempFile --project=$project 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  ✓ Created" -ForegroundColor Green
                $createdCount++
            } else {
                Write-Host "  ✗ Failed to create" -ForegroundColor Red
            }
        }
    } finally {
        # Clean up temp file
        Remove-Item -Path $tempFile -Force -ErrorAction SilentlyContinue
    }
    
    Write-Host ""
}

Write-Host "======================================"
Write-Host "Summary" -ForegroundColor Cyan
Write-Host "======================================"
Write-Host "Created/Updated: $createdCount" -ForegroundColor Green
Write-Host "Skipped: $skippedCount" -ForegroundColor Yellow
Write-Host ""

# Verify all secrets
Write-Host "Verifying secrets..." -ForegroundColor Yellow
$allSecrets = gcloud secrets list --project=$project --format="value(name)" 2>&1

Write-Host ""
Write-Host "Secrets in project:" -ForegroundColor Cyan
$allSecrets | ForEach-Object { Write-Host "  ✓ $_" }
Write-Host ""

# Get project number for service account
Write-Host "Getting project number..." -ForegroundColor Gray
$projectNumber = gcloud projects describe $project --format="value(projectNumber)" 2>&1

Write-Host ""
Write-Host "======================================"
Write-Host "Next Steps: Grant Permissions"
Write-Host "======================================"
Write-Host ""
Write-Host "Run these commands to grant the Firebase service account access:" -ForegroundColor Yellow
Write-Host ""

$secretNames = @("livekit-api-key", "livekit-api-secret", "livekit-url", "discord-client-id", "discord-client-secret", "twitch-client-id", "twitch-client-secret")

foreach ($secretName in $secretNames) {
    Write-Host "gcloud secrets add-iam-policy-binding $secretName \" -ForegroundColor Cyan
    Write-Host "    --member=serviceAccount:service-$projectNumber@gcp-sa-firebase-apphosting.iam.gserviceaccount.com \" -ForegroundColor Cyan
    Write-Host "    --role=roles/secretmanager.secretAccessor" -ForegroundColor Cyan
    Write-Host ""
}

Write-Host "Or run this PowerShell command to do all at once:" -ForegroundColor Yellow
Write-Host ""
Write-Host {
@"
`$projectNumber = gcloud projects describe (gcloud config get-value project) --format='value(projectNumber)' | Out-String
`$secrets = @('livekit-api-key', 'livekit-api-secret', 'livekit-url', 'discord-client-id', 'discord-client-secret', 'twitch-client-id', 'twitch-client-secret')
foreach (`$secret in `$secrets) {
    gcloud secrets add-iam-policy-binding `$secret `
        --member=serviceAccount:service-`$projectNumber.Trim()@gcp-sa-firebase-apphosting.iam.gserviceaccount.com `
        --role=roles/secretmanager.secretAccessor
}
Write-Host "All permissions granted!" -ForegroundColor Green
"@
} -ForegroundColor Cyan

Write-Host ""
Write-Host "======================================"
Write-Host "Ready to Deploy!" -ForegroundColor Green
Write-Host "======================================"
Write-Host ""
Write-Host "Your secrets are now in Google Secret Manager."
Write-Host "apphosting.yaml is configured to use them."
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Run the permission-granting commands above"
Write-Host "  2. npm install tmi.js"
Write-Host "  3. firebase deploy"
Write-Host ""
