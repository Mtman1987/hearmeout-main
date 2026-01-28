#!/bin/bash
# Script to create Google Cloud Secret Manager secrets for HearMeOut deployment
# Usage: bash create-secrets.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== HearMeOut Secret Manager Setup ===${NC}\n"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI is not installed. Install it from: https://cloud.google.com/sdk/docs/install${NC}"
    exit 1
fi

# Get current project
PROJECT_ID=$(gcloud config get-value project)
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: No default Google Cloud project set. Run: gcloud config set project YOUR_PROJECT_ID${NC}"
    exit 1
fi

echo -e "${GREEN}Using project: $PROJECT_ID${NC}\n"

# Array of secrets to create
declare -A SECRETS=(
    ["livekit-api-key"]="Your LiveKit API Key"
    ["livekit-api-secret"]="Your LiveKit API Secret"
    ["livekit-url"]="Your LiveKit URL (e.g., https://livekit.example.com)"
    ["discord-client-id"]="Your Discord OAuth Client ID"
    ["discord-client-secret"]="Your Discord OAuth Client Secret"
    ["twitch-client-id"]="Your Twitch OAuth Client ID"
    ["twitch-client-secret"]="Your Twitch OAuth Client Secret"
)

echo "This script will create the following secrets in Google Secret Manager:"
for secret_name in "${!SECRETS[@]}"; do
    echo "  - $secret_name"
done

echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
fi

echo ""

# Create each secret
for secret_name in "${!SECRETS[@]}"; do
    prompt="${SECRETS[$secret_name]}"
    
    # Check if secret already exists
    if gcloud secrets describe "$secret_name" &> /dev/null; then
        echo -e "${YELLOW}Secret '$secret_name' already exists. Skip? (y/n)${NC}"
        read -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            continue
        fi
    fi
    
    # Prompt for secret value
    read -sp "Enter $prompt: " SECRET_VALUE
    echo
    
    if [ -z "$SECRET_VALUE" ]; then
        echo -e "${RED}Error: Secret value cannot be empty. Skipping '$secret_name'.${NC}"
        continue
    fi
    
    # Create or update secret
    if gcloud secrets describe "$secret_name" &> /dev/null; then
        echo "Updating secret: $secret_name"
        echo -n "$SECRET_VALUE" | gcloud secrets versions add "$secret_name" --data-file=-
    else
        echo "Creating secret: $secret_name"
        echo -n "$SECRET_VALUE" | gcloud secrets create "$secret_name" --replication-policy="automatic" --data-file=-
    fi
    
    echo -e "${GREEN}✓ Secret '$secret_name' created/updated${NC}\n"
done

echo -e "${GREEN}=== All secrets created! ===${NC}"
echo ""
echo "Next steps:"
echo "1. Verify secrets were created: gcloud secrets list"
echo "2. Grant Firebase App Hosting service account access to these secrets"
echo "3. Deploy with: firebase deploy --only hosting"
