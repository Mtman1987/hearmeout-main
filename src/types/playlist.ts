export type PlaylistItem = {
  id: string;
  title: string;
  artist: string;
  artId: string;
  thumbnail?: string;
  url: string;
  duration: number;
  addedBy: string;
  addedAt: Date;
  plays: number;
  source: 'web' | 'discord' | 'twitch' | 'offline';
  playbackUrl?: string;
  playbackStrategy?: 'proxy' | 'embed' | 'offline';
};
