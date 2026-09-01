export type RoomBotDescriptor = {
  displayName: string;
  wakeNames: string[];
  targetTenantId?: string;
};

export type BotInvocation = {
  displayName: string;
  targetTenantId?: string;
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function wakeNameMatchIndex(value: string, wakeName: string) {
  const normalized = String(wakeName || '').trim().replace(/^@/, '');
  if (!normalized) return -1;
  const match = new RegExp(`(^|[^a-z0-9_])@?${escapeRegex(normalized)}([^a-z0-9_]|$)`, 'i').exec(value);
  return match?.index ?? -1;
}

export function resolveBotInvocation(value: string, bots: RoomBotDescriptor[] = []): BotInvocation | null {
  let bestMatch: {
    displayName: string;
    targetTenantId?: string;
    index: number;
    wakeNameLength: number;
  } | null = null;

  for (const bot of bots) {
    for (const wakeName of bot.wakeNames) {
      const index = wakeNameMatchIndex(value, wakeName);
      if (index < 0) continue;
      const wakeNameLength = String(wakeName || '').trim().length;
      if (
        !bestMatch
        || index < bestMatch.index
        || (index === bestMatch.index && wakeNameLength > bestMatch.wakeNameLength)
      ) {
        bestMatch = {
          displayName: bot.displayName,
          targetTenantId: bot.targetTenantId,
          index,
          wakeNameLength,
        };
      }
    }
  }

  return bestMatch
    ? { displayName: bestMatch.displayName, targetTenantId: bestMatch.targetTenantId }
    : null;
}
