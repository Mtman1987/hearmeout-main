/**
 * Twitch Token Seeder — no redirects to our apps.
 * 
 * Opens https://twitchtokengenerator.com or you can use the Twitch CLI.
 * Or just paste a token you already have.
 * 
 * Usage: node seed-twitch-token.js
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const readline = require('readline');

const CLIENT_ID = 'rxmohc28tthq0nudfd6iwx0sgy88dp';
const SERVER_ID = '1240832965865635881';

console.log('\n=== Twitch Token Seeder ===\n');
console.log('Go to this URL in your browser:\n');
console.log('  https://twitchtokengenerator.com/quick/VfDMrE1lJb\n');
console.log('Or generate a token at https://twitchtokengenerator.com');
console.log('  - Select "Bot Chat Token"');
console.log('  - Scopes needed: chat:read, chat:edit');
console.log('  - Authorize with the Twitch account you want the bot to use\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Paste your ACCESS TOKEN: ', async (accessToken) => {
  accessToken = accessToken.trim().replace(/^oauth:/i, '');
  
  if (!accessToken) {
    console.error('❌ No token provided.');
    rl.close();
    process.exit(1);
  }

  // Validate it
  console.log('\nValidating token...');
  try {
    const validateRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${accessToken}` },
    });

    if (!validateRes.ok) {
      console.error('❌ Token is invalid. Make sure you copied the ACCESS TOKEN (not the refresh token).');
      rl.close();
      process.exit(1);
    }

    const info = await validateRes.json();
    console.log(`✅ Token valid for: ${info.login} (ID: ${info.user_id})`);
    console.log(`   Scopes: ${info.scopes?.join(', ') || 'none'}`);
    console.log(`   Expires in: ${Math.round(info.expires_in / 3600)}h`);

    rl.question('\nPaste your REFRESH TOKEN (or press Enter to skip): ', async (refreshToken) => {
      refreshToken = (refreshToken || '').trim();

      const tokenData = {
        accessToken,
        refreshToken,
        expiresAt: Date.now() + (info.expires_in * 1000),
        username: info.login,
        userId: info.user_id,
        serverId: SERVER_ID,
        scope: info.scopes || ['chat:read', 'chat:edit'],
        updatedAt: new Date().toISOString(),
      };

      // Save seed file
      const outPath = path.join(__dirname, 'data', `twitch-bot-seed-${SERVER_ID}.json`);
      fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(tokenData, null, 2));
      console.log(`\n📁 Saved: ${outPath}`);

      // Update DSH export
      const dshPath = path.join(__dirname, '..', 'DiscordStreamHub', 'local-db-export', 'servers', SERVER_ID, 'config', 'twitchBotOAuth.json');
      try {
        fs.writeFileSync(dshPath, JSON.stringify({
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          expiresAt: tokenData.expiresAt,
          scope: tokenData.scope,
          botUsername: tokenData.username,
          botUserId: tokenData.userId,
          updatedAt: tokenData.updatedAt,
        }, null, 2));
        console.log(`📁 Updated DSH export: ${dshPath}`);
      } catch {
        console.log('⚠️  Could not update DSH export');
      }

      console.log(`\n✅ Done! Bot will connect as "${tokenData.username}" when HMO starts.\n`);
      rl.close();
      process.exit(0);
    });

  } catch (e) {
    console.error('❌ Error:', e.message || e);
    rl.close();
    process.exit(1);
  }
});
