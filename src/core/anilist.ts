import { HttpClient } from './http-client.js';
import { globalCache } from './cache.js';

export interface AniListMedia {
  id: number;
  idMal?: number | null;
  title: {
    english?: string | null;
    romaji?: string | null;
    native?: string | null;
  };
  status: 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';
  format?: string | null;
  episodes?: number | null;
  seasonYear?: number | null;
  synonyms: string[];
  nextAiringEpisode?: {
    episode: number;
    airingAt: number;
    timeUntilAiring: number;
  } | null;
  latestAiredEpisode: number;
  episodesMeta?: Record<string, any>;
}

export class AniListClient {
  static async getMedia(anilistId: number): Promise<AniListMedia> {
    const cacheKey = `anilist:media:${anilistId}`;
    const cached = globalCache.get<AniListMedia>(cacheKey);
    if (cached) return cached;

    // Primary: AniZip API (handles mappings, all titles, episode count, episode thumbnails)
    try {
      const azRes = await HttpClient.getJson<any>(`https://api.ani.zip/mappings?anilist_id=${anilistId}`);
      if (azRes && azRes.titles) {
        const titles = azRes.titles || {};
        const mappings = azRes.mappings || {};
        const epCount = azRes.episodeCount || Object.keys(azRes.episodes || {}).length || 0;

        const synonyms: string[] = [];
        for (const [lang, t] of Object.entries(titles)) {
          if (typeof t === 'string' && t && !synonyms.includes(t)) {
            synonyms.push(t);
          }
        }

        const media: AniListMedia = {
          id: anilistId,
          idMal: mappings.mal_id || null,
          title: {
            english: titles.en || titles['x-jat'] || null,
            romaji: titles['x-jat'] || titles.en || null,
            native: titles.ja || null,
          },
          status: epCount > 0 ? 'FINISHED' : 'RELEASING',
          format: mappings.type || 'TV',
          episodes: epCount,
          synonyms,
          latestAiredEpisode: epCount,
          episodesMeta: azRes.episodes || {},
        };

        globalCache.set(cacheKey, media, 1800);
        return media;
      }
    } catch {}

    // Secondary fallback: AniList GraphQL
    try {
      const query = `query ($id: Int) { Media(id: $id, type: ANIME) { id idMal title { english romaji native } status format episodes seasonYear synonyms nextAiringEpisode { episode airingAt } } }`;
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({ query, variables: { id: anilistId } }),
      });
      const json = await res.json();
      const data = json?.data?.Media;
      if (data) {
        let latestAired = data.episodes || 0;
        if (data.status === 'RELEASING' && data.nextAiringEpisode?.episode) {
          latestAired = Math.max(0, data.nextAiringEpisode.episode - 1);
        }

        const media: AniListMedia = {
          id: data.id,
          idMal: data.idMal || null,
          title: data.title || {},
          status: data.status,
          format: data.format,
          episodes: data.episodes,
          seasonYear: data.seasonYear,
          synonyms: Array.isArray(data.synonyms) ? data.synonyms : [],
          nextAiringEpisode: data.nextAiringEpisode || null,
          latestAiredEpisode: latestAired,
        };

        globalCache.set(cacheKey, media, 1800);
        return media;
      }
    } catch {}

    throw new Error(`Could not resolve anime metadata for AniList ID: ${anilistId}`);
  }
}
