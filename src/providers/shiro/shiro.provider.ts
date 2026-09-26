import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';

export class ShiroProvider extends BaseProvider {
  readonly name = 'shiro';
  readonly defaultBaseUrl = 'https://shiro.so';
  readonly mirrorUrls = ["https://shiro.so","https://shiro.is"];
  readonly languages = ['en'];
  readonly isSelfHosted = true;
  readonly librarySize = '4,500+';
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
      const list = Array.isArray(response.data) ? response.data : response.data?.data || [];

      const results: AnimeSearchResult[] = list.map((item: any) => ({
        id: String(item.slug || item.id),
        title: item.title || item.name || '',
        japaneseTitle: item.romaji,
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
    const url = `${baseUrl}/api/anime/${animeId}/episodes`;

    try {
      const response = await axios.get<any>(url, { headers: this.getHeaders(), timeout: 10000 });
      const list = Array.isArray(response.data) ? response.data : response.data?.data || [];

      const episodes: Episode[] = list.map((item: any) => {
        const epNum = parseFloat(item.number || item.episodeNumber || '1');
        return {
          id: `${animeId}:${epNum}`,
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
    return [{ id: `${animeId}:${episodeNumber}:shiro`, name: 'Shiro-CDN (Self-Hosted)', subType: 'sub' }];
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    serverId: string,
    subType: 'sub' | 'dub'
  ): Promise<StreamResolutionResult> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/api/stream/${animeId}/${episodeNumber}`;

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
        server: serverId || 'Shiro-CDN',
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
        server: serverId || 'Shiro-CDN',
        sources: [],
        subtitles: [],
      };
    }
  }
}

export const shiroProvider = new ShiroProvider();
