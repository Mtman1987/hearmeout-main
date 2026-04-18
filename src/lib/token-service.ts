'use server';

import { db } from '@/lib/db';

/**
 * Token service for HearMeOut.
 * 
 * Architecture: DSH is the auth authority. Tokens are stored per-server.
 * HMO caches them locally in its own DB under config/twitch_bot_{serverId}.
 * Each user authorizes with their own Twitch account — there is no shared bot account.
 */

function dbKey(serverId: string) {
  return `twitch_bot_${serverId}`;
}

export async function getUserBotToken(serverId: string, _discordUserId: string): Promise<string | null> {
  try {
    const data = db.get('config', dbKey(serverId));
    if (!data?.accessToken) return null;

    // Check expiry if we have it
    if (data.expiresAt && Date.now() >= data.expiresAt) {
      const refreshed = await refreshUserBotToken(serverId, _discordUserId, data.refreshToken);
      return refreshed;
    }

    return data.accessToken;
  } catch (error) {
    console.error(`[Token] Error getting bot token for server ${serverId}:`, error);
    return null;
  }
}

export async function getUserBotUsername(serverId: string, _discordUserId: string): Promise<string | null> {
  try {
    const data = db.get('config', dbKey(serverId));
    return data?.username || null;
  } catch (error) {
    console.error(`[Token] Error getting bot username for server ${serverId}:`, error);
    return null;
  }
}

export async function storeUserBotToken(
  serverId: string,
  _discordUserId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  username: string,
  userId: string,
  twitchLogin: string
): Promise<void> {
  db.set('config', dbKey(serverId), {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (expiresIn * 1000),
    username: twitchLogin || username,
    userId,
    serverId,
    updatedAt: new Date().toISOString(),
  });
  console.log(`[Token] Stored bot token for server ${serverId} (${twitchLogin})`);
}

export async function refreshUserBotToken(serverId: string, _discordUserId: string, refreshToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID!,
        client_secret: process.env.TWITCH_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      console.error(`[Token] Refresh failed for server ${serverId}:`, response.status);
      return null;
    }

    const data = await response.json();
    const existing = db.get('config', dbKey(serverId)) || {};

    db.set('config', dbKey(serverId), {
      ...existing,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + (data.expires_in * 1000),
      updatedAt: new Date().toISOString(),
    });

    console.log(`[Token] Refreshed token for server ${serverId}`);
    return data.access_token;
  } catch (error) {
    console.error(`[Token] Error refreshing token for server ${serverId}:`, error);
    return null;
  }
}

export async function getAllUsersWithTokens(_serverId: string): Promise<Array<{ discordUserId: string; twitchLogin: string; username: string }>> {
  // In the per-server model, each server has one bot token (the user who authorized).
  // Return that user's info.
  try {
    const data = db.get('config', dbKey(_serverId));
    if (!data?.accessToken || !data?.username) return [];
    return [{
      discordUserId: data.userId || 'unknown',
      twitchLogin: data.username,
      username: data.username,
    }];
  } catch {
    return [];
  }
}

export async function validateToken(token: string): Promise<boolean> {
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
