import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';

/**
 * AllAnime Provider (https://allanime.to / https://api.allanime.day)
 * Everything.moe index:
 * - Library Size: 9,000+
 * - Server: Hybrid (Large self-hosted endpoints + multi-provider mirrors)
 */
export class AllAnimeProvider extends BaseProvider {
  readonly name = 'allanime';
  readonly defaultBaseUrl = 'https://api.allanime.day';
  readonly mirrorUrls = [
    'https://api.allanime.day',
    'https://allanime.to',
    'https://allanime.day',
  ];
  readonly languages = ['en'];
  readonly isSelfHosted = true;
  readonly librarySize = '9,000+';
  readonly serverType = 'hybrid' as const;

  private readonly apiEndpoint = 'https://api.allanime.day/api';

  constructor() {
    super();
    this.init();
  }

  private getHeaders(): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Referer': 'https://allanime.to/',
      'Accept': 'application/json',
    };
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<AnimeSearchResult[]>(cacheKey);
    if (cached) return cached;

    const gqlQuery = `query($search: SearchInput, $limit: Int, $page: Int) {
      shows(search: $search, limit: $limit, page: $page) {
        edges {
          _id
          name
          thumbnail
          englishName
          availableEpisodesDetail
        }
      }
    }`;

    try {
      const response = await axios.post<{ data: { shows: { edges: any[] } } }>(
        this.apiEndpoint,
        {
          query: gqlQuery,
          variables: {
            search: { query: query.trim() },
            limit: 20,
            page: 1,
          },
        },
        {
          headers: this.getHeaders(),
          timeout: 10000,
        }
      );

      const edges = response.data?.data?.shows?.edges || [];
      const results: AnimeSearchResult[] = edges.map((item: any) => ({
        id: item._id,
        title: item.englishName || item.name || '',
        japaneseTitle: item.name !== item.englishName ? item.name : undefined,
        poster: item.thumbnail,
        provider: this.name,
      }));

      globalCache.set(cacheKey, results, 3600);
      return results;
    } catch {
      return [];
    }
  }

  async getEpisodes(animeId: string): Promise<Episode[]> {
    const cacheKey = this.getCacheKey('episodes', animeId);
    const cached = globalCache.get<Episode[]>(cacheKey);
    if (cached) return cached;

    const gqlQuery = `query($showId: String!) {
      show(_id: $showId) {
        _id
        name
        availableEpisodesDetail
      }
    }`;

    try {
      const response = await axios.post<{ data: { show: any } }>(
        this.apiEndpoint,
        {
          query: gqlQuery,
          variables: { showId: animeId },
        },
        {
          headers: this.getHeaders(),
          timeout: 10000,
        }
      );

      const show = response.data?.data?.show;
      const subEps: string[] = show?.availableEpisodesDetail?.sub || [];
      const dubEps: string[] = show?.availableEpisodesDetail?.dub || [];
      const allNums = Array.from(new Set([...subEps, ...dubEps]))
        .map((n) => parseFloat(n))
        .filter((n) => !isNaN(n))
        .sort((a, b) => a - b);

      const episodes: Episode[] = allNums.map((num) => ({
        id: `${animeId}:${num}`,
        number: num,
        title: `Episode ${num}`,
        hasSub: subEps.includes(String(num)),
        hasDub: dubEps.includes(String(num)),
      }));

      globalCache.set(cacheKey, episodes, 3600);
      return episodes;
    } catch {
      return [];
    }
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    return [
      { id: `${animeId}:${episodeNumber}:sub`, name: 'AllAnime-Sub (Self-Hosted)', subType: 'sub' },
      { id: `${animeId}:${episodeNumber}:dub`, name: 'AllAnime-Dub (Self-Hosted)', subType: 'dub' },
    ];
  }

  private decryptSourceUrl(sourceUrl: string): string {
    if (!sourceUrl.startsWith('--')) return sourceUrl;
    try {
      const hex = sourceUrl.slice(2);
      let str = '';
      for (let i = 0; i < hex.length; i += 2) {
        const byte = parseInt(hex.substr(i, 2), 16) ^ 56;
        str += String.fromCharCode(byte);
      }
      return str;
    } catch {
      return sourceUrl;
    }
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    serverId: string,
    subType: 'sub' | 'dub'
  ): Promise<StreamResolutionResult> {
    const gqlQuery = `query($showId: String!, $episodeString: String!, $translationType: VaildTranslationTypeEnumType!) {
      episode(showId: $showId, episodeString: $episodeString, translationType: $translationType) {
        sourceUrls
      }
    }`;

    try {
      const response = await axios.post<{ data: { episode: { sourceUrls: any[] } } }>(
        this.apiEndpoint,
        {
          query: gqlQuery,
          variables: {
            showId: animeId,
            episodeString: String(episodeNumber),
            translationType: subType === 'dub' ? 'dub' : 'sub',
          },
        },
        {
          headers: this.getHeaders(),
          timeout: 10000,
        }
      );

      const sourceUrls = response.data?.data?.episode?.sourceUrls || [];
      const sources: VideoSource[] = [];

      for (const item of sourceUrls) {
        const rawUrl = item.sourceUrl || '';
        const decrypted = this.decryptSourceUrl(rawUrl);

        if (decrypted && decrypted.startsWith('http')) {
          const isM3u8 = decrypted.includes('.m3u8');
          sources.push({
            url: decrypted,
            type: isM3u8 ? 'hls' : 'mp4',
            quality: item.sourceName || 'auto',
            isM3U8: isM3u8,
          });
        }
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: 'AllAnime-CDN',
        sources,
        subtitles: [],
        headers: {
          Referer: 'https://allanime.to/',
          'User-Agent': this.getHeaders()['User-Agent'],
        },
      };
    } catch {
      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || 'AllAnime-CDN',
        sources: [],
        subtitles: [],
      };
    }
  }
}

export const allAnimeProvider = new AllAnimeProvider();
