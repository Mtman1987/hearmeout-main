'use server';

import { db } from '@/lib/db';

const SERVER_ID = process.env.HARDCODED_GUILD_ID || '1240832965865635881';

function getTwitchOAuthConfig() {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.NEXT_PUBLIC_TWITCH_CLIENT_SECRET || process.env.TWITCH_CLIENT_SECRET;
  return { clientId, clientSecret };
}

interface UserTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  username: string;
  userId: string;
  twitchLogin: string;
}

/**
 * Get user's bot token (stored per Discord user)
 */
export async function getUserBotToken(serverId: string, discordUserId: string): Promise<string | null> {
  try {
    const tokenDoc = await db.collection('servers').doc(serverId).collection('users').doc(discordUserId).collection('tokens').doc('twitchBot').get();
    
    if (!tokenDoc.exists) {
      return null;
    }

    const data = tokenDoc.data() as UserTokens;
    
    // Check if expired
    if (data.expiresAt && Date.now() >= data.expiresAt) {
      const refreshed = await refreshUserBotToken(serverId, discordUserId, data.refreshToken);
      if (refreshed) return refreshed;
      return null;
    }
    
    return data.accessToken;
  } catch (error) {
    console.error(`[Token] Error getting bot token for user ${discordUserId}:`, error);
    return null;
  }
}

/**
 * Get user's Twitch username from their bot token
 */
export async function getUserBotUsername(serverId: string, discordUserId: string): Promise<string | null> {
  try {
    const tokenDoc = await db.collection('servers').doc(serverId).collection('users').doc(discordUserId).collection('tokens').doc('twitchBot').get();
    
    if (!tokenDoc.exists) {
      return null;
    }

    const data = tokenDoc.data() as UserTokens;
    return data.username || null;
  } catch (error) {
    console.error(`[Token] Error getting bot username for user ${discordUserId}:`, error);
    return null;
  }
}

/**
 * Store user's bot token
 */
export async function storeUserBotToken(
  serverId: string,
  discordUserId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  username: string,
  userId: string,
  twitchLogin: string
): Promise<void> {
  try {
    await db.collection('servers').doc(serverId).collection('users').doc(discordUserId).collection('tokens').doc('twitchBot').set({
      accessToken,
      refreshToken,
      expiresAt: Date.now() + (expiresIn * 1000),
      username,
      userId,
      twitchLogin,
      updatedAt: new Date().toISOString(),
    });
    console.log(`[Token] Stored bot token for user ${discordUserId} (${username})`);
  } catch (error) {
    console.error(`[Token] Error storing bot token for user ${discordUserId}:`, error);
    throw error;
  }
}

/**
 * Refresh user's bot token
 */
async function refreshUserBotToken(serverId: string, discordUserId: string, refreshToken: string): Promise<string | null> {
  try {
    const { clientId, clientSecret } = getTwitchOAuthConfig();
    if (!clientId || !clientSecret) {
      console.error(`[Token] Twitch OAuth config missing for user ${discordUserId}`);
      return null;
    }

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      console.error(`[Token] Refresh failed for user ${discordUserId}:`, response.status);
      return null;
    }

    const data = await response.json();

    await db.collection('servers').doc(serverId).collection('users').doc(discordUserId).collection('tokens').doc('twitchBot').update({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + (data.expires_in * 1000),
      updatedAt: new Date().toISOString(),
    });

    console.log(`[Token] Refreshed bot token for user ${discordUserId}`);
    return data.access_token;
  } catch (error) {
    console.error(`[Token] Error refreshing token for user ${discordUserId}:`, error);
    return null;
  }
}

/**
 * Get all users with bot tokens
 */
export async function getAllUsersWithTokens(serverId: string): Promise<Array<{discordUserId: string, twitchLogin: string, username: string}>> {
  try {
    const usersSnapshot = await db.collection('servers').doc(serverId).collection('users').get();
    const usersWithTokens: Array<{discordUserId: string, twitchLogin: string, username: string}> = [];

    for (const userDoc of usersSnapshot.docs) {
      const tokenDoc = await userDoc.ref.collection('tokens').doc('twitchBot').get();
      if (tokenDoc.exists) {
        const data = tokenDoc.data() as UserTokens;
        usersWithTokens.push({
          discordUserId: userDoc.id,
          twitchLogin: data.twitchLogin,
          username: data.username,
        });
      }
    }

    return usersWithTokens;
  } catch (error) {
    console.error('[Token] Error getting users with tokens:', error);
    return [];
  }
}

/**
 * Validate token
 */
export async function validateToken(token: string): Promise<boolean> {
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${token}` },
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}
