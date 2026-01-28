export type PlaylistItem = {
  id: string;
  title: string;
  artist: string;
  artId: string;
  url: string;
  duration: number;
  addedBy: string;
  addedAt: Date;
  plays: number;
  source: 'web' | 'discord' | 'twitch';
};
