// Fetches the full user profile from DSH and merges into HMO's local user doc
// isAdmin is pre-computed by DSH during Discord sync based on admin role config

import { db, ensureDb } from '@/lib/db';
import { DSH_URL, HARDCODED_GUILD_ID } from '@/lib/constants';

const SERVER_ID = process.env.HARDCODED_GUILD_ID || HARDCODED_GUILD_ID;

export async function enrichUserFromDSH(discordId: string): Promise<Record<string, any> | null> {
  await ensureDb();
  const uid = discordId.startsWith('discord_') ? discordId : `discord_${discordId}`;
  const rawId = uid.replace('discord_', '');
  if (!SERVER_ID) return null;

  try {
    const res = await fetch(`${DSH_URL}/api/db?path=servers/${SERVER_ID}/users/${rawId}`);
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
    enriched.discordGuildId = SERVER_ID;
    enriched.enrichedAt = new Date().toISOString();

    db.set('users', uid, enriched, { merge: true });

    return { ...db.get('users', uid), ...enriched };
  } catch (error) {
    console.error('[EnrichUser] Failed to fetch DSH profile:', error);
    return null;
  }
}
