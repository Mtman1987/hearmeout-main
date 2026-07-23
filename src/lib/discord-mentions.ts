function readDiscordMention(source: any, userId: string): any | null {
  if (!source) return null;
  if (Array.isArray(source)) {
    return source.find((entry: any) =>
      String(entry?.id || entry?.userId || entry?.user?.id || '') === userId
    ) || null;
  }
  return source[userId] || null;
}

export function replaceDiscordUserMentions(text: unknown, dataOrMentions: any): string {
  const mentions = dataOrMentions?.mentions || dataOrMentions || {};
  return String(text || '').replace(/<@!?(\d+)>/g, (mention, userId) => {
    const user = readDiscordMention(mentions.users || mentions, userId);
    const member = readDiscordMention(mentions.members, userId);
    const displayName =
      member?.displayName ||
      member?.display_name ||
      member?.nick ||
      member?.user?.globalName ||
      member?.user?.global_name ||
      member?.user?.username ||
      user?.displayName ||
      user?.globalName ||
      user?.global_name ||
      user?.username;
    return displayName ? `@${displayName}` : mention;
  });
}
