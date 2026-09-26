import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource, SubtitleTrack } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';

/**
 * KickAssAnime Provider (https://kaas.to / https://kickassanime.am)
 * Everything.moe index:
 * - Library Size: 4,200+
 * - Server: Self-Hosted (Birdstream / Duckstream custom streaming network)
 */
export class KickAssAnimeProvider extends BaseProvider {
  readonly name = 'kickassanime';
  readonly defaultBaseUrl = 'https://kaa.lt';
  readonly mirrorUrls = ["https://kaa.lt","https://kaas.to"];
  readonly languages = ['en'];
  readonly isSelfHosted = true;
  readonly librarySize = '4,200+';
  readonly serverType = 'self-hosted' as const;

  constructor() {
    super();
    this.init();
  }

  private getHeaders(): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Referer': `${this.getBaseUrl()}/`,
      'Accept': 'application/json, text/plain, */*',
    };
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<AnimeSearchResult[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/api/show/search?q=${encodeURIComponent(query.trim())}`;

    try {
      const response = await axios.get<any>(url, {
        headers: this.getHeaders(),
        timeout: 10000,
      });

      const list = Array.isArray(response.data)
        ? response.data
        : response.data?.result || response.data?.data || [];

      const results: AnimeSearchResult[] = list.map((item: any) => ({
        id: item.slug || String(item.id),
        title: item.title_en || item.title || item.name || '',
        japaneseTitle: item.title_original || undefined,
        poster: item.poster?.url || item.poster || undefined,
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

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/api/show/${animeId}/episodes`;

    try {
      const response = await axios.get<any>(url, {
        headers: this.getHeaders(),
        timeout: 10000,
      });

      const list = Array.isArray(response.data)
        ? response.data
        : response.data?.pages || response.data?.result || [];

      const episodes: Episode[] = list.map((item: any) => {
        const epNum = parseFloat(item.episode_number || item.episode_string || item.number || '1');
        return {
          id: `${animeId}/episode/${epNum}`,
          number: isNaN(epNum) ? 1 : epNum,
          title: item.title || `Episode ${epNum}`,
          hasSub: true,
          hasDub: false,
        };
      });

      episodes.sort((a, b) => a.number - b.number);
      globalCache.set(cacheKey, episodes, 3600);
      return episodes;
    } catch {
      return [];
    }
  }

  async getServers(animeId: string, episodeNumber: number): Promise<Server[]> {
    return [
      { id: `${animeId}:${episodeNumber}:birdstream`, name: 'BirdStream (Self-Hosted)', subType: 'sub' },
      { id: `${animeId}:${episodeNumber}:duckstream`, name: 'DuckStream (Self-Hosted)', subType: 'sub' },
    ];
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    serverId: string,
    subType: 'sub' | 'dub'
  ): Promise<StreamResolutionResult> {
    const baseUrl = this.getBaseUrl();
    const epUrl = `${baseUrl}/api/show/${animeId}/episode/${episodeNumber}`;

    try {
      const response = await axios.get<any>(epUrl, {
        headers: this.getHeaders(),
        timeout: 10000,
      });

      const serversList = response.data?.servers || [];
      const sources: VideoSource[] = [];
      const subtitles: SubtitleTrack[] = [];

      for (const s of serversList) {
        const name = (s.name || '').toLowerCase();
        if (s.src) {
          const isM3u8 = s.src.includes('.m3u8');
          sources.push({
            url: s.src,
            type: isM3u8 ? 'hls' : 'mp4',
            quality: name.includes('1080') ? '1080p' : name.includes('720') ? '720p' : 'auto',
            isM3U8: isM3u8,
          });
        }
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId.includes('duck') ? 'DuckStream' : 'BirdStream',
        sources,
        subtitles,
        headers: {
          Referer: `${baseUrl}/`,
          'User-Agent': this.getHeaders()['User-Agent'],
        },
      };
    } catch {
      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || 'BirdStream',
        sources: [],
        subtitles: [],
      };
    }
  }
}

export const kickAssAnimeProvider = new KickAssAnimeProvider();
