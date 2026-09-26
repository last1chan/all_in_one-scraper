import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';

export class AniBdProvider extends BaseProvider {
  readonly name = 'anibd';
  readonly defaultBaseUrl = 'https://anibd.app';
  readonly mirrorUrls = ['https://anibd.app'];
  readonly languages = ['en'];
  readonly isSelfHosted = false;
  readonly librarySize = '5,500+';
  readonly serverType = 'third-party' as const;

  constructor() {
    super();
    this.init();
  }

  private getHeaders(): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Referer': `${this.getBaseUrl()}/`,
      'Accept': 'application/json',
    };
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<AnimeSearchResult[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/api/search?q=${encodeURIComponent(query.trim())}`;

    try {
      const response = await axios.get<any>(url, { headers: this.getHeaders(), timeout: 10000 });
      const list = Array.isArray(response.data) ? response.data : response.data?.results || [];

      const results: AnimeSearchResult[] = list.map((item: any) => ({
        id: String(item.id || item.slug),
        title: item.title?.english || item.title || item.name || '',
        japaneseTitle: item.title?.romaji,
        poster: item.image || item.poster,
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
    const url = `${baseUrl}/api/anime/${animeId}`;

    try {
      const response = await axios.get<any>(url, { headers: this.getHeaders(), timeout: 10000 });
      const episodesList = response.data?.episodes || [];

      const episodes: Episode[] = episodesList.map((item: any) => {
        const num = parseFloat(item.number || item.episodeNumber || '1');
        return {
          id: `${animeId}:${num}`,
          number: isNaN(num) ? 1 : num,
          title: item.title || `Episode ${num}`,
          hasSub: true,
          hasDub: Boolean(item.hasDub),
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
    return [{ id: `${animeId}:${episodeNumber}:anibd`, name: 'AniBD-Server', subType: 'sub' }];
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    serverId: string,
    subType: 'sub' | 'dub'
  ): Promise<StreamResolutionResult> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/api/watch/${animeId}/${episodeNumber}`;

    try {
      const response = await axios.get<any>(url, { headers: this.getHeaders(), timeout: 10000 });
      const sourcesList = response.data?.sources || [];
      const sources: VideoSource[] = [];

      for (const s of sourcesList) {
        if (s.url) {
          const isM3u8 = s.url.includes('.m3u8');
          sources.push({
            url: s.url,
            type: isM3u8 ? 'hls' : 'mp4',
            quality: s.quality || 'auto',
            isM3U8: isM3u8,
          });
        }
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || 'AniBD-Server',
        sources,
        subtitles: [],
        headers: { Referer: `${baseUrl}/`, 'User-Agent': this.getHeaders()['User-Agent'] },
      };
    } catch {
      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || 'AniBD-Server',
        sources: [],
        subtitles: [],
      };
    }
  }
}

export const aniBdProvider = new AniBdProvider();
