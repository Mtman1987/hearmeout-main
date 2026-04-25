// Fetches the full user profile from DSH and merges into HMO's local user doc
// isAdmin is pre-computed by DSH during Discord sync based on admin role config

import { db, ensureDb } from '@/lib/db';
import { getDshUrl, getHardcodedGuildId } from '@/lib/runtime-config';

export async function enrichUserFromDSH(discordId: string): Promise<Record<string, any> | null> {
  await ensureDb();

  const uid = discordId.startsWith('discord_') ? discordId : `discord_${discordId}`;
  const rawId = uid.replace('discord_', '');
  const serverId = getHardcodedGuildId();

  try {
    const res = await fetch(`${getDshUrl()}/api/db?path=servers/${serverId}/users/${rawId}`);
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.exists || !data.data) return null;

    const dsh = data.data;
    const enriched: Record<string, any> = {};

    if (dsh.twitchLogin) enriched.twitchLogin = dsh.twitchLogin;
    if (dsh.twitchId) enriched.twitchId = dsh.twitchId;
    if (dsh.roles) enriched.roles = dsh.roles;
    if (dsh.group) enriched.group = dsh.group;
    if (dsh.username) enriched.username = dsh.username;
    if (dsh.displayName) enriched.displayName = dsh.displayName;
    if (dsh.avatarUrl) enriched.photoURL = dsh.avatarUrl;
    enriched.isAdmin = dsh.isAdmin === true;
    enriched.discordGuildId = serverId;
    enriched.enrichedAt = new Date().toISOString();

    await db.setAsync('users', uid, enriched, { merge: true });

    const currentUser = (await db.getAsync('users', uid)) || {};
    return { ...currentUser, ...enriched };
  } catch (error) {
    console.error('[EnrichUser] Failed to fetch DSH profile:', error);
    return null;
  }
}