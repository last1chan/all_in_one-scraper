import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource, SubtitleTrack } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';

/**
 * Miruro Provider (https://www.miruro.tv / https://miruro.online)
 * Everything.moe index:
 * - Library Size: 7,000+
 * - Server: Hybrid / Direct
 * - Note: Might need residential proxy due to Cloudflare Turnstile protection
 */
export class MiruroProvider extends BaseProvider {
  readonly name = 'miruro';
  readonly defaultBaseUrl = 'https://www.miruro.to';
  readonly mirrorUrls = ["https://www.miruro.to","https://www.miruro.tv"];
  readonly languages = ['en'];
  readonly isSelfHosted = true;
  readonly librarySize = '7,000+';
  readonly serverType = 'hybrid' as const;
  readonly notes = 'Might require residential proxy to bypass Cloudflare protection';

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
    const url = `${baseUrl}/api/anime/search?query=${encodeURIComponent(query.trim())}`;

    try {
      const response = await axios.get<any>(url, { headers: this.getHeaders(), timeout: 10000 });
      const list = Array.isArray(response.data) ? response.data : response.data?.results || [];

      const results: AnimeSearchResult[] = list.map((item: any) => ({
        id: String(item.id || item.animeId),
        title: item.title?.english || item.title?.romaji || item.title || '',
        japaneseTitle: item.title?.native,
        poster: item.coverImage?.large || item.image || item.poster,
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
    const url = `${baseUrl}/api/anime/info/${animeId}`;

    try {
      const response = await axios.get<any>(url, { headers: this.getHeaders(), timeout: 10000 });
      const epsList = response.data?.episodes || [];

      const episodes: Episode[] = epsList.map((item: any) => {
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
    return [
      { id: `${animeId}:${episodeNumber}:pahe`, name: 'Miruro-Pahe (Self-Hosted)', subType: 'sub' },
      { id: `${animeId}:${episodeNumber}:gogo`, name: 'Miruro-Direct', subType: 'sub' },
    ];
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    serverId: string,
    subType: 'sub' | 'dub'
  ): Promise<StreamResolutionResult> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/api/anime/watch/${animeId}?ep=${episodeNumber}&subType=${subType}`;

    try {
      const response = await axios.get<any>(url, { headers: this.getHeaders(), timeout: 10000 });
      const sourcesList = response.data?.sources || [];
      const sources: VideoSource[] = [];
      const subtitles: SubtitleTrack[] = [];

      for (const s of sourcesList) {
        if (s.url) {
          const isM3u8 = s.url.includes('.m3u8') || s.isM3U8;
          sources.push({
            url: s.url,
            type: isM3u8 ? 'hls' : 'mp4',
            quality: s.quality || 'auto',
            isM3U8: isM3u8,
          });
        }
      }

      for (const t of response.data?.subtitles || []) {
        if (t.url) {
          subtitles.push({
            url: t.url,
            label: t.lang || t.label || 'English',
            srclang: t.lang,
          });
        }
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || 'Miruro-CDN',
        sources,
        subtitles,
        headers: { Referer: `${baseUrl}/`, 'User-Agent': this.getHeaders()['User-Agent'] },
      };
    } catch {
      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || 'Miruro-CDN',
        sources: [],
        subtitles: [],
      };
    }
  }
}

export const miruroProvider = new MiruroProvider();
