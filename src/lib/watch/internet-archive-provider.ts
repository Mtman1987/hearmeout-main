type ArchiveDoc = {
  identifier?: string;
  title?: string;
  year?: string;
  description?: string;
};

type ArchiveFile = {
  name?: string;
  format?: string;
  size?: string;
};

type WatchCatalogItem = {
  id: string;
  type: 'movie' | 'live';
  title: string;
  year: number;
  runtime: string;
  source: string;
  poster: string;
  playbackUrl: string;
  overview: string;
};

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function scoreTitle(title: string, query: string) {
  const needle = normalize(query);
  const haystack = normalize(title);
  const words = needle.split(/\s+/).filter((word) => word.length >= 3);
  let score = 0;
  if (haystack === needle) score += 100;
  if (haystack.includes(needle)) score += 50;
  for (const word of words) {
    if (haystack.includes(word)) score += 8;
  }
  return score;
}

function archiveSearchUrl(query: string) {
  const url = new URL('https://archive.org/advancedsearch.php');
  url.searchParams.set('q', `mediatype:(movies) AND (${query})`);
  url.searchParams.append('fl[]', 'identifier');
  url.searchParams.append('fl[]', 'title');
  url.searchParams.append('fl[]', 'year');
  url.searchParams.append('fl[]', 'description');
  url.searchParams.set('rows', '10');
  url.searchParams.set('page', '1');
  url.searchParams.set('output', 'json');
  return url;
}

async function fetchJson<T>(url: URL | string): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'user-agent': 'DiscordStreamHub/1.0' },
  });
  if (!response.ok) throw new Error(`Internet Archive returned ${response.status}`);
  return response.json() as Promise<T>;
}

function pickPlayableFile(files: ArchiveFile[] = []) {
  return files
    .filter((file) => {
      const name = file.name || '';
      const format = normalize(file.format);
      return name.toLowerCase().endsWith('.mp4') || format.includes('mpeg4') || format.includes('h.264');
    })
    .sort((a, b) => Number(b.size || 0) - Number(a.size || 0))[0] || null;
}

function fileUrl(identifier: string, filename: string) {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${filename.split('/').map(encodeURIComponent).join('/')}`;
}

export async function findInternetArchiveRecommendation(query: string | null | undefined): Promise<WatchCatalogItem | null> {
  const needle = normalize(query);
  if (!needle) return null;

  const search = await fetchJson<{ response?: { docs?: ArchiveDoc[] } }>(archiveSearchUrl(needle));
  const docs = (search.response?.docs || [])
    .map((doc) => ({ doc, score: scoreTitle(doc.title || doc.identifier || '', needle) }))
    .filter((entry) => entry.doc.identifier && entry.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { doc } of docs) {
    const metadata = await fetchJson<{ files?: ArchiveFile[] }>(`https://archive.org/metadata/${encodeURIComponent(doc.identifier!)}`).catch(() => null);
    const playable = pickPlayableFile(metadata?.files || []);
    if (!playable?.name) continue;

    const parsedYear = Number(doc.year);
    return {
      id: `archive-${doc.identifier}`,
      type: 'movie',
      title: doc.title || doc.identifier!,
      year: Number.isFinite(parsedYear) && parsedYear > 1800 ? parsedYear : new Date().getFullYear(),
      runtime: 'archive',
      source: 'Internet Archive',
      poster: `https://archive.org/services/img/${encodeURIComponent(doc.identifier!)}`,
      playbackUrl: fileUrl(doc.identifier!, playable.name),
      overview: `Internet Archive fallback result for "${needle}".`,
    };
  }

  return null;
}
