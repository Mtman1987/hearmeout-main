'use server';

import { PlaylistItem } from "@/types/playlist";
import { db, ensureDb } from '@/lib/db';
import YouTube from 'youtube-sr';
import { getAi } from '@/ai/genkit';
import { findOfflineMusicTrack, findSavedMusicTrack, saveSearchedMusicTrack } from '@/lib/offline-music';

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function selectArtId(videoId: string): string {
  const artIds = ["album-art-1", "album-art-2", "album-art-3"];
  return artIds[simpleHash(videoId || '') % artIds.length];
}

type AutoRadioProfileTrack = {
  videoId: string;
  title: string;
  artist: string;
  playedAt: number;
};

type AutoRadioProfiles = Record<string, { recent: AutoRadioProfileTrack[] }>;
type AutoRadioFailures = Record<string, { count: number; lastFailedAt: number; reason?: string }>;
type AutoRadioQueryStats = Record<string, { success: number; failure: number; lastTriedAt: number }>;

const AUTO_RADIO_PROFILE_LIMIT = 12;
const AUTO_RADIO_RECENT_NO_REPEAT = 20;
const AUTO_RADIO_FAIL_BLOCK_COUNT = 2;
const AUTO_RADIO_FAIL_BLOCK_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const AUTO_RADIO_HARD_BLOCK_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const AUTO_RADIO_HARD_BLOCK_REASONS = ['private', 'region', 'age-restricted', 'copyright'];
const COLD_START_QUERIES = [
  'indie pop essentials',
  'alt rock essentials',
  'lofi chill beats',
  'synthwave essentials',
  'dance pop hits',
  'hip hop chill playlist',
];
function updateUserAutoRadioProfile(
  profiles: AutoRadioProfiles | undefined,
  userId: string,
  track: { id: string; title: string; artist: string },
): AutoRadioProfiles {
  const nextProfiles: AutoRadioProfiles = { ...(profiles || {}) };
  const currentRecent = nextProfiles[userId]?.recent || [];
  const nextRecent: AutoRadioProfileTrack[] = [
    ...currentRecent,
    { videoId: track.id, title: track.title, artist: track.artist, playedAt: Date.now() },
  ].slice(-AUTO_RADIO_PROFILE_LIMIT);
  nextProfiles[userId] = { recent: nextRecent };
  return nextProfiles;
}

function isFailureBlocked(videoId: string, failures: AutoRadioFailures | undefined): boolean {
  const fail = failures?.[videoId];
  if (!fail) return false;
  const reason = (fail.reason || '').toLowerCase();
  const hardReason = AUTO_RADIO_HARD_BLOCK_REASONS.some((r) => reason.includes(r));
  if (hardReason) {
    return Date.now() - fail.lastFailedAt < AUTO_RADIO_HARD_BLOCK_MS;
  }
  const isFreshBlock = Date.now() - fail.lastFailedAt < AUTO_RADIO_FAIL_BLOCK_MS;
  return fail.count >= AUTO_RADIO_FAIL_BLOCK_COUNT && isFreshBlock;
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

function queryScore(query: string, stats: AutoRadioQueryStats): number {
  const key = normalizeQuery(query);
  const row = stats[key];
  if (!row) return 0;
  const total = row.success + row.failure;
  const ratio = total > 0 ? row.success / total : 0;
  return ratio * 10 - row.failure * 0.5;
}

function markQueryStat(stats: AutoRadioQueryStats, query: string, ok: boolean): AutoRadioQueryStats {
  const key = normalizeQuery(query);
  const prev = stats[key] || { success: 0, failure: 0, lastTriedAt: 0 };
  return {
    ...stats,
    [key]: {
      success: prev.success + (ok ? 1 : 0),
      failure: prev.failure + (ok ? 0 : 1),
      lastTriedAt: Date.now(),
    },
  };
}

function buildWeightedSeedTracks(profiles: AutoRadioProfiles): AutoRadioProfileTrack[] {
  const all = Object.entries(profiles).flatMap(([uid, p]) =>
    (p.recent || []).map((t, idx) => ({ ...t, uid, idx })),
  );
  all.sort((a, b) => a.playedAt - b.playedAt);
  const now = Date.now();
  const perUserCount: Record<string, number> = {};
  const weighted: AutoRadioProfileTrack[] = [];

  for (const t of all.slice(-80)) {
    perUserCount[t.uid] = (perUserCount[t.uid] || 0) + 1;
    const ageMs = Math.max(1, now - t.playedAt);
    const recencyWeight = Math.max(1, Math.round(6 - Math.min(5, ageMs / (1000 * 60 * 30))));
    const userFreqWeight = Math.min(3, perUserCount[t.uid]);
    const copies = Math.max(1, recencyWeight + userFreqWeight - 1);
    for (let i = 0; i < copies; i++) weighted.push({
      videoId: t.videoId,
      title: t.title,
      artist: t.artist,
      playedAt: t.playedAt,
    });
  }
  return weighted.slice(-120);
}

async function suggestQueriesFromAI(seedTracks: AutoRadioProfileTrack[], bannedTitles: string[]): Promise<string[]> {
  if (!seedTracks.length) return [];
  try {
    const ai = getAi();
    const profile = seedTracks.slice(-30).map((t) => `${t.artist} - ${t.title}`).join('\n');
    const banned = bannedTitles.slice(-30).join('\n');
    const prompt = `You are selecting music recommendations for auto radio.
Return strict JSON only: {"queries": ["artist - title", ...]} with exactly 8 items.
Rules:
- Similar vibe to the profile
- Avoid any exact title in the banned list
- Favor playable/popular YouTube tracks
- Include artist in each query

Profile tracks:
${profile}

Banned titles:
${banned}`;
    const res = await ai.generate({ prompt, config: { temperature: 0.7 } });
    const text = String(res?.text || '').trim();
    const parsed = JSON.parse(text);
    const queries = Array.isArray(parsed?.queries) ? parsed.queries : [];
    return queries.map((q: unknown) => String(q).trim()).filter(Boolean).slice(0, 8);
  } catch {
    return [];
  }
}

export async function addSongToPlaylist(
  songQuery: string,
  roomId: string,
  requester: string
): Promise<{ success: boolean; message: string }> {
  if (!roomId) return { success: false, message: 'No room ID provided.' };

  try {
    await ensureDb();
    const resolved = await resolveSongRequest(songQuery, requester);
    if (!resolved.success || !resolved.track) return { success: false, message: resolved.message };
    const newTrack = resolved.track;

    const room = db.get('rooms', roomId);
    if (!room) return { success: false, message: 'Room not found.' };

    const playlist = room.playlist || [];
    const newPlaylist = [...playlist, newTrack];
    const updates: any = { playlist: newPlaylist };
    updates.autoRadioProfiles = updateUserAutoRadioProfile(room.autoRadioProfiles, requester || 'unknown', {
      id: newTrack.id,
      title: newTrack.title,
      artist: newTrack.artist,
    });

    if (!room.isPlaying || !room.currentTrackId) {
      updates.currentTrackId = newTrack.id;
      updates.isPlaying = true;
      if (room.currentTrackId) {
        updates.playHistory = [...(room.playHistory || []), room.currentTrackId].slice(-50);
      }
    }

    db.update('rooms', roomId, updates);
    console.log(`[!sr] Queued "${newTrack.title}" in room ${roomId}`);

    return { success: true, message: `Queued up: "${newTrack.title}"` };
  } catch (error: any) {
    console.error(`[!sr] Error:`, error);
    return { success: false, message: 'An internal error occurred.' };
  }
}

export async function resolveSongRequest(
  songQuery: string,
  requester: string
): Promise<{ success: boolean; message: string; track?: PlaylistItem }> {
  const trimmedQuery = String(songQuery || '').trim();
  if (!trimmedQuery) return { success: false, message: 'No song query provided.' };

  try {
    const isUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+/.test(trimmedQuery);

    let videoId: string;
    let title: string;
    let artist: string;
    let url: string;
    let thumbnail: string | undefined;
    let duration: number;

    if (isUrl) {
      try {
        const video = await YouTube.getVideo(trimmedQuery);
        if (!video?.id) return { success: false, message: 'Could not load that YouTube URL.' };
        videoId = video.id;
        title = video.title || 'Untitled';
        artist = video.channel?.name || 'Unknown Artist';
        url = video.url;
        thumbnail = video.thumbnail?.url;
        duration = video.duration || 180000;
      } catch {
        const normalizedUrl = /^https?:\/\//i.test(trimmedQuery) ? trimmedQuery : `https://${trimmedQuery}`;
        const parsedUrl = new URL(normalizedUrl);
        videoId = parsedUrl.hostname.includes('youtu.be')
          ? parsedUrl.pathname.replace(/^\//, '')
          : parsedUrl.searchParams.get('v') || parsedUrl.pathname.split('/').filter(Boolean).pop() || '';
        if (!videoId) return { success: false, message: 'Could not find a YouTube video ID in that URL.' };
        title = trimmedQuery;
        artist = 'Unknown';
        url = normalizedUrl;
        duration = 180000;
      }
    } else {
      const offlineTrack = await findOfflineMusicTrack(trimmedQuery);
      if (offlineTrack) {
        if (isConfidentStoredSongMatch(trimmedQuery, offlineTrack.title, offlineTrack.artist)) {
          console.log(`[!sr] Found offline backup: "${offlineTrack.title}" (${offlineTrack.id})`);
          return {
            success: true,
            message: `Queued offline backup: "${offlineTrack.title}"`,
            track: {
              id: offlineTrack.id,
              title: offlineTrack.title,
              artist: offlineTrack.artist,
              url: offlineTrack.playbackUrl,
              playbackUrl: offlineTrack.playbackUrl,
              thumbnail: undefined,
              artId: selectArtId(offlineTrack.id),
              duration: offlineTrack.duration,
              addedBy: requester,
              addedAt: new Date(),
              plays: 0,
              source: 'offline' as const,
              playbackStrategy: 'offline',
            },
          };
        }
        console.warn(`[!sr] Ignoring weak offline song match for "${trimmedQuery}": "${offlineTrack.title}" by ${offlineTrack.artist}`);
      }

      const savedTrack = await findSavedMusicTrack(trimmedQuery);
      if (savedTrack) {
        if (isConfidentStoredSongMatch(trimmedQuery, savedTrack.title, savedTrack.artist)) {
          console.log(`[!sr] Found saved song metadata: "${savedTrack.title}" (${savedTrack.id})`);
          return {
            success: true,
            message: `Queued saved song: "${savedTrack.title}"`,
            track: {
              id: savedTrack.id,
              title: savedTrack.title,
              artist: savedTrack.artist,
              url: savedTrack.url,
              thumbnail: savedTrack.thumbnail,
              artId: selectArtId(savedTrack.id),
              duration: savedTrack.duration,
              addedBy: requester,
              addedAt: new Date(),
              plays: 0,
              source: 'web' as const,
              playbackStrategy: 'proxy',
            },
          };
        }
        console.warn(`[!sr] Ignoring weak saved song match for "${trimmedQuery}": "${savedTrack.title}" by ${savedTrack.artist}`);
      }

      const results: any[] = [];
      const seenVideoIds = new Set<string>();
      for (const searchQuery of buildSongSearchQueries(trimmedQuery)) {
        const queryResults = await YouTube.search(searchQuery, { limit: 8, type: 'video' }).catch(() => []);
        for (const result of queryResults || []) {
          const id = String(result?.id || '');
          if (!id || seenVideoIds.has(id)) continue;
          seenVideoIds.add(id);
          results.push(result);
        }
      }
      const scoredResults = results
        .filter((result) => result?.id)
        .map((result) => ({ result, score: scoreSongSearchResult(trimmedQuery, result) }))
        .sort((a, b) => b.score - a.score);
      const bestResult = scoredResults[0];
      if (!bestResult?.result?.id) {
        return { success: false, message: `No results for "${trimmedQuery}". Try a different search.` };
      }
      if (!isConfidentSongMatch(trimmedQuery, bestResult.score)) {
        return { success: false, message: `No confident song match for "${trimmedQuery}". Try "artist - title" or paste a YouTube URL.` };
      }
      const video = bestResult.result;
      videoId = String(video.id);
      title = video.title || 'Untitled';
      artist = video.channel?.name || 'Unknown Artist';
      url = video.url || `https://www.youtube.com/watch?v=${videoId}`;
      thumbnail = video.thumbnail?.url;
      duration = video.duration || 180000;
    }

    console.log(`[!sr] Found: "${title}" by ${artist} (${videoId})`);
    await saveSearchedMusicTrack({
      id: videoId,
      title,
      artist,
      url,
      thumbnail,
      duration,
    }, trimmedQuery);

    return {
      success: true,
      message: `Queued up: "${title}"`,
      track: {
        id: videoId,
        title,
        artist,
        url,
        thumbnail,
        artId: selectArtId(videoId),
        duration,
        addedBy: requester,
        addedAt: new Date(),
        plays: 0,
        source: 'web' as const,
        playbackStrategy: 'proxy',
      },
    };
  } catch (error: any) {
    console.error(`[!sr] Error:`, error);
    return { success: false, message: 'An internal error occurred.' };
  }
}

function tokenizeSongText(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !['the', 'and', 'feat', 'ft', 'official', 'music', 'video', 'audio', 'lyrics', 'lyric'].includes(token));
}

function parseSongQueryTokens(query: string) {
  const normalized = String(query || '').trim();
  const byMatch = normalized.match(/^(.+?)\s+by\s+(.+)$/i);
  const dashMatch = normalized.match(/^(.+?)\s+-\s+(.+)$/);
  if (byMatch) {
    return {
      titleTokens: tokenizeSongText(byMatch[1]),
      artistTokens: tokenizeSongText(byMatch[2]),
      queryTokens: tokenizeSongText(normalized),
    };
  }
  if (dashMatch) {
    return {
      artistTokens: tokenizeSongText(dashMatch[1]),
      titleTokens: tokenizeSongText(dashMatch[2]),
      queryTokens: tokenizeSongText(normalized),
    };
  }
  return {
    titleTokens: tokenizeSongText(normalized),
    artistTokens: [] as string[],
    queryTokens: tokenizeSongText(normalized),
  };
}

function buildSongSearchQueries(query: string) {
  const normalized = String(query || '').trim();
  const byMatch = normalized.match(/^(.+?)\s+by\s+(.+)$/i);
  const dashMatch = normalized.match(/^(.+?)\s+-\s+(.+)$/);
  const candidates: string[] = [];

  if (byMatch) {
    const title = byMatch[1].trim();
    const artist = byMatch[2].trim();
    candidates.push(`${artist} ${title}`, `${artist} - ${title}`, `${title} ${artist}`);
  } else if (dashMatch) {
    const artist = dashMatch[1].trim();
    const title = dashMatch[2].trim();
    candidates.push(`${artist} ${title}`, `${artist} - ${title}`, `${title} ${artist}`);
  }

  candidates.push(normalized);
  return Array.from(new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))).slice(0, 4);
}

function countMatches(tokens: string[], haystack: string) {
  return tokens.filter((token) => haystack.includes(token)).length;
}

function scoreSongSearchResult(query: string, video: any) {
  const title = tokenizeSongText(video?.title).join(' ');
  const channel = tokenizeSongText(video?.channel?.name).join(' ');
  const combined = `${title} ${channel}`;
  const { titleTokens, artistTokens, queryTokens } = parseSongQueryTokens(query);
  if (!queryTokens.length) return 0;

  let score = 0;
  const titleMatches = countMatches(titleTokens, title);
  const artistMatches = countMatches(artistTokens, combined);
  const queryMatches = countMatches(queryTokens, combined);

  score += queryMatches * 12;
  score += titleMatches * 20;
  score += artistMatches * 24;
  if (titleTokens.length && titleMatches === titleTokens.length) score += 35;
  if (artistTokens.length && artistMatches === artistTokens.length) score += 35;
  if (artistTokens.length && artistMatches === 0) score -= 45;
  if (titleTokens.length && titleMatches === 0) score -= 45;

  return score;
}

function isConfidentSongMatch(query: string, score: number) {
  const parsed = parseSongQueryTokens(query);
  const hasArtistHint = parsed.artistTokens.length > 0;
  return score >= (hasArtistHint ? 70 : 45);
}

function isConfidentStoredSongMatch(query: string, title: string, artist: string) {
  const score = scoreSongSearchResult(query, { title, channel: { name: artist } });
  return isConfidentSongMatch(query, score);
}

export async function updateRoomPlayState(roomId: string, isPlaying: boolean): Promise<{ success: boolean; message: string }> {
  if (!roomId) return { success: false, message: 'No room ID provided.' };
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) return { success: false, message: 'Room not found.' };
  if (!room.currentTrackId) return { success: false, message: 'No track is currently selected.' };
  db.update('rooms', roomId, { isPlaying });
  const trackTitle = room.playlist?.find((t: any) => t.id === room.currentTrackId)?.title || 'Current track';
  return { success: true, message: `${isPlaying ? 'Playing' : 'Paused'}: "${trackTitle}"` };
}

export async function rememberAutoRadioTrack(roomId: string, track: PlaylistItem, userId: string) {
  if (!roomId || !track?.id) return;
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) return;
  const playlist: PlaylistItem[] = room.playlist || [];
  const alreadyStored = playlist.some((item) => item.id === track.id);
  db.update('rooms', roomId, {
    playlist: alreadyStored ? playlist : [...playlist, track].slice(-100),
    autoRadioProfiles: updateUserAutoRadioProfile(room.autoRadioProfiles || {}, userId || 'listener', {
      id: track.id,
      title: track.title || 'Unknown Title',
      artist: track.artist || 'Unknown Artist',
    }),
  });
}

export async function setAutoRadioEnabled(roomId: string, enabled: boolean) {
  if (!roomId) return false;
  await ensureDb();
  if (!db.get('rooms', roomId)) return false;
  db.update('rooms', roomId, { autoRadio: enabled });
  return true;
}

export async function skipTrack(roomId: string): Promise<{ success: boolean; message: string }> {
  if (!roomId) return { success: false, message: 'No room ID provided.' };
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) return { success: false, message: 'Room not found.' };
  const playlist = room.playlist || [];
  if (!playlist.length) return { success: false, message: 'Playlist is empty.' };
  const currentIndex = playlist.findIndex((t: any) => t.id === room.currentTrackId);
  const nextTrack = playlist[(currentIndex + 1) % playlist.length];
  const updates: any = { currentTrackId: nextTrack.id, isPlaying: true };
  if (room.currentTrackId) {
    updates.playHistory = [...(room.playHistory || []), room.currentTrackId].slice(-50);
  }
  db.update('rooms', roomId, updates);
  return { success: true, message: 'Skipped to next track.' };
}

export async function autoRadioNext(roomId: string): Promise<{ success: boolean; message: string }> {
  if (!roomId) return { success: false, message: 'No room ID provided.' };
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) return { success: false, message: 'Room not found.' };
  if (!room.autoRadio) return { success: false, message: 'Auto-radio is not enabled.' };

  const playHistory: string[] = room.playHistory || [];
  const playlist: PlaylistItem[] = room.playlist || [];
  const autoRadioProfiles: AutoRadioProfiles = room.autoRadioProfiles || {};
  const autoRadioFailures: AutoRadioFailures = room.autoRadioFailures || {};
  const autoRadioQueryStats: AutoRadioQueryStats = room.autoRadioQueryStats || {};

  const seedFromProfiles: AutoRadioProfileTrack[] = buildWeightedSeedTracks(autoRadioProfiles).slice(-60);

  const fallbackSeedTracks: AutoRadioProfileTrack[] = [...playlist]
    .slice(-10)
    .map((t) => ({
      videoId: t.id,
      title: t.title || 'Unknown Title',
      artist: t.artist || 'Unknown Artist',
      playedAt: Date.now(),
    }));
  const seedTracks = seedFromProfiles.length ? seedFromProfiles : fallbackSeedTracks;

  const historyIds = new Set<string>([...playHistory, ...playlist.map((t) => t.id)]);
  const recentPlayedIds = new Set(playHistory.slice(-AUTO_RADIO_RECENT_NO_REPEAT));
  const bannedTitles = [...playlist.map((t) => t.title), ...seedTracks.map((t) => t.title)];

  const fallbackQueries: string[] = [];
  const recentArtists = seedTracks.map((t) => t.artist).filter((a) => a && a !== 'Unknown Artist' && a !== 'Unknown');
  if (recentArtists.length) {
    fallbackQueries.push(...recentArtists.slice(-6).map((a) => `${a} top songs`));
  }
  fallbackQueries.push(...COLD_START_QUERIES);

  const aiQueries = await suggestQueriesFromAI(seedTracks, bannedTitles);
  const allQueries = [...aiQueries, ...fallbackQueries]
    .map((q) => q.trim())
    .filter(Boolean)
    .filter((q, i, arr) => arr.indexOf(q) === i)
    .sort((a, b) => queryScore(b, autoRadioQueryStats) - queryScore(a, autoRadioQueryStats));

  try {
    let picked: any | null = null;
    let winningQuery = '';
    let nextStats = { ...autoRadioQueryStats };
    for (const query of allQueries) {
      const results = await YouTube.search(query, { limit: 5, type: 'video' });
      const candidates = results.filter((v) => {
        if (!v?.id) return false;
        if (historyIds.has(v.id)) return false;
        if (recentPlayedIds.has(v.id)) return false;
        if (isFailureBlocked(v.id, autoRadioFailures)) return false;
        return true;
      });
      if (candidates.length) {
        picked = candidates[0];
        winningQuery = query;
        nextStats = markQueryStat(nextStats, query, true);
        break;
      }
      nextStats = markQueryStat(nextStats, query, false);
    }
    if (!picked?.id) {
      db.update('rooms', roomId, { autoRadioQueryStats: nextStats });
      return { success: false, message: 'No new songs found for auto-radio.' };
    }

    const videoId = picked.id!;
    const newTrack: PlaylistItem = {
      id: videoId,
      title: picked.title || 'Untitled',
      artist: picked.channel?.name || 'Unknown Artist',
      url: picked.url,
      thumbnail: picked.thumbnail?.url,
      artId: selectArtId(videoId),
      duration: picked.duration || 180000,
      addedBy: 'Auto-Radio',
      addedAt: new Date(),
      plays: 0,
      source: 'web' as const,
    };

    const newPlaylist = [...playlist, newTrack];
    const historySeed = room.currentTrackId
      ? [...playHistory, room.currentTrackId]
      : playHistory;
    const newHistory = [...historySeed, videoId].slice(-50);
    db.update('rooms', roomId, {
      playlist: newPlaylist,
      currentTrackId: videoId,
      isPlaying: true,
      playHistory: newHistory,
      autoRadioProfiles: updateUserAutoRadioProfile(autoRadioProfiles, 'auto_radio', {
        id: newTrack.id,
        title: newTrack.title,
        artist: newTrack.artist || 'Unknown Artist',
      }),
      autoRadioQueryStats: nextStats,
      autoRadioLastWinningQuery: winningQuery,
    });

    return { success: true, message: `Auto-radio queued: "${newTrack.title}"` };
  } catch (error: any) {
    console.error('[Auto-Radio] Error:', error);
    return { success: false, message: 'Auto-radio search failed.' };
  }
}

export async function getRoomState(roomId: string) {
  if (!roomId) return null;
  await ensureDb();
  const data = db.get('rooms', roomId);
  if (!data) return null;
  return {
    isPlaying: data.isPlaying || false,
    currentTrack: data.playlist?.find((t: any) => t.id === data.currentTrackId) || null,
    playlistLength: data.playlist?.length || 0,
    djDisplayName: data.djDisplayName || 'No DJ',
    autoRadio: data.autoRadio === true,
  };
}

export async function markTrackExtractFailure(roomId: string, videoId: string, reason?: string): Promise<void> {
  if (!roomId || !videoId) return;
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) return;
  const failures: AutoRadioFailures = room.autoRadioFailures || {};
  const existing = failures[videoId] || { count: 0, lastFailedAt: 0 };
  failures[videoId] = {
    count: existing.count + 1,
    lastFailedAt: Date.now(),
    reason: reason || existing.reason,
  };
  db.update('rooms', roomId, { autoRadioFailures: failures });
}
