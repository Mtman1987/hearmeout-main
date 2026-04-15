// Quick test: can the Twitch bot connect to chat?
// Run: node test-bot-connection.js

require('dotenv').config();
const tmi = require('tmi.js');

const TOKEN = process.env.TWITCH_BOT_OAUTH_TOKEN;
const USERNAME = process.env.TWITCH_BOT_USERNAME || 'Athenabot87';
const CHANNEL = process.env.TWITCH_BROADCASTER_USERNAME || 'mtman1987';

if (!TOKEN) {
  console.error('❌ TWITCH_BOT_OAUTH_TOKEN is missing from .env');
  process.exit(1);
}

async function testToken() {
  console.log(`\n🔑 Validating token for ${USERNAME}...`);
  try {
    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${TOKEN}` },
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`✅ Token is VALID`);
      console.log(`   Login: ${data.login}`);
      console.log(`   User ID: ${data.user_id}`);
      console.log(`   Expires in: ${Math.round(data.expires_in / 3600)}h`);
      console.log(`   Scopes: ${data.scopes?.join(', ') || 'none'}`);
      return true;
    } else {
      const err = await res.json().catch(() => ({}));
      console.error(`❌ Token is INVALID (${res.status}):`, err.message || res.statusText);
      console.error('   → You need to re-auth the bot. The token has expired.');
      return false;
    }
  } catch (e) {
    console.error('❌ Could not reach Twitch API:', e.message);
    return false;
  }
}

async function testConnection() {
  console.log(`\n📡 Attempting to connect as ${USERNAME} and join #${CHANNEL}...`);

  const client = new tmi.client({
    identity: {
      username: USERNAME,
      password: `oauth:${TOKEN}`,
    },
    channels: [CHANNEL],
    connection: { reconnect: false },
  });

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.error('❌ Connection timed out after 15s');
      client.disconnect().catch(() => {});
      resolve(false);
    }, 15000);

    client.on('connected', (addr, port) => {
      console.log(`✅ Connected to Twitch IRC at ${addr}:${port}`);
    });

    client.on('join', (channel, username, self) => {
      if (self) {
        console.log(`✅ Joined ${channel} successfully!`);
        console.log(`\n🎉 Bot is WORKING — it can see chat in #${CHANNEL}`);
        clearTimeout(timeout);
        client.disconnect().then(() => resolve(true)).catch(() => resolve(true));
      }
    });

    client.on('notice', (channel, msgid, message) => {
      console.warn(`⚠️  Notice [${msgid}]: ${message}`);
      if (msgid === 'msg_banned' || message.includes('authentication failed')) {
        console.error('❌ Bot is BANNED or auth failed in this channel');
        clearTimeout(timeout);
        client.disconnect().catch(() => {});
        resolve(false);
      }
    });

    client.connect().catch((err) => {
      console.error('❌ Connection failed:', err);
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

(async () => {
  console.log('=== HearMeOut Twitch Bot Connection Test ===');
  
  const tokenOk = await testToken();
  if (!tokenOk) {
    console.log('\n💡 Fix: Re-generate the bot OAuth token at https://twitchtokengenerator.com');
    console.log('   Then update TWITCH_BOT_OAUTH_TOKEN in your .env file.');
    process.exit(1);
  }

  const connected = await testConnection();
  if (!connected) {
    console.log('\n💡 Possible causes:');
    console.log('   1. Token is valid but missing chat:read / chat:edit scopes');
    console.log('   2. Bot is banned in the channel');
    console.log('   3. Network/firewall blocking IRC (port 6667/443)');
    process.exit(1);
  }

  console.log('\n✅ All checks passed. The bot can connect and watch for !sr commands.');
  process.exit(0);
})();
