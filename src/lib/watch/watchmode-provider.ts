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

type WatchmodeSearchResult = {
  id?: number;
  name?: string;
  title?: string;
  year?: number;
  type?: string;
};

function getApiKey() {
  return process.env.WATCHMODE_API_KEY || process.env.NEXT_PUBLIC_WATCHMODE_API_KEY || '';
}

function normalize(value: unknown) {
  return String(value || '').trim();
}

function searchValues(query: string) {
  const cleaned = query
    .replace(/\bs(?:eason)?\s*\d{1,3}\s*e(?:p(?:isode)?)?\s*\d{1,3}\b/gi, '')
    .replace(/\bs\d{1,3}e\d{1,3}\b/gi, '')
    .replace(/\bseason\s*\d{1,3}\b/gi, '')
    .replace(/\b(?:episode|episodes|ep)\s*\d{1,3}\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(new Set([query, cleaned].map(normalize).filter(Boolean)));
}

function watchmodeUrl(path: string) {
  const url = new URL(path, 'https://api.watchmode.com');
  url.searchParams.set('apiKey', getApiKey());
  return url;
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Watchmode returned ${response.status}`);
  return response.json() as Promise<T>;
}

function toMetadataItem(result: WatchmodeSearchResult): WatchCatalogItem | null {
  const title = normalize(result.name || result.title);
  if (!title) return null;

  const id = result.id ? String(result.id) : title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const type = normalize(result.type).toLowerCase();

  return {
    id: `watchmode-${id}`,
    type: 'movie',
    title,
    year: Number(result.year) || new Date().getFullYear(),
    runtime: type === 'tv_series' || type === 'tv' ? 'show' : 'movie',
    source: 'Watchmode discovery',
    poster: '',
    playbackUrl: '',
    overview: 'Watchmode metadata match. This identifies the title and where it may be available, but does not provide a direct playable stream.',
  };
}

export async function findWatchmodeRecommendation(query: string | null | undefined): Promise<WatchCatalogItem | null> {
  const needle = normalize(query);
  if (!needle || !getApiKey()) return null;

  for (const value of searchValues(needle)) {
    const searchTitleUrl = watchmodeUrl('/v1/search-title/');
    searchTitleUrl.searchParams.set('search_value', value);
    searchTitleUrl.searchParams.set('search_type', '1');

    const searchUrl = watchmodeUrl('/v1/search/');
    searchUrl.searchParams.set('search_field', 'name');
    searchUrl.searchParams.set('search_value', value);

    const payload = await fetchJson<{ title_results?: WatchmodeSearchResult[]; results?: WatchmodeSearchResult[] }>(searchTitleUrl)
      .catch(() => fetchJson<{ title_results?: WatchmodeSearchResult[]; results?: WatchmodeSearchResult[] }>(searchUrl))
      .catch(() => null);

    const results = payload?.title_results || payload?.results || [];
    const item = results.map(toMetadataItem).find(Boolean);
    if (item) return item;
  }

  return null;
}
