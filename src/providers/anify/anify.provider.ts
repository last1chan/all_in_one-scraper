import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource, SubtitleTrack } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';

export class AnifyProvider extends BaseProvider {
  readonly name = 'anify';
  readonly defaultBaseUrl = 'https://anify.to';
  readonly mirrorUrls = ["https://anify.to","https://anify.eltik.cc","https://api.anify.tv"];
  readonly languages = ['en'];
  readonly isSelfHosted = false;
  readonly librarySize = '12,000+';
  readonly serverType = 'hybrid' as const;

  constructor() {
    super();
    this.init();
  }

  private getHeaders(): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    };
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<AnimeSearchResult[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/search/anime/${encodeURIComponent(query.trim())}`;

    try {
      const response = await axios.get<any>(url, { headers: this.getHeaders(), timeout: 10000 });
      const list = Array.isArray(response.data) ? response.data : response.data?.results || [];

      const results: AnimeSearchResult[] = list.map((item: any) => ({
        id: String(item.id),
        title: item.title?.english || item.title?.romaji || item.title || '',
        japaneseTitle: item.title?.native,
        poster: item.coverImage,
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
    const url = `${baseUrl}/info/${animeId}`;

    try {
      const response = await axios.get<any>(url, { headers: this.getHeaders(), timeout: 10000 });
      const episodesList = response.data?.episodes?.data || response.data?.episodes || [];

      const episodes: Episode[] = episodesList.map((item: any) => {
        const num = parseFloat(item.number || '1');
        return {
          id: `${animeId}:${num}`,
          number: isNaN(num) ? 1 : num,
          title: item.title || `Episode ${num}`,
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
    return [{ id: `${animeId}:${episodeNumber}:anify`, name: 'Anify-Stream', subType: 'sub' }];
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    serverId: string,
    subType: 'sub' | 'dub'
  ): Promise<StreamResolutionResult> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/sources?id=${animeId}&episodeNumber=${episodeNumber}&subType=${subType}`;

    try {
      const response = await axios.get<any>(url, { headers: this.getHeaders(), timeout: 10000 });
      const sourcesList = response.data?.sources || [];
      const sources: VideoSource[] = [];
      const subtitles: SubtitleTrack[] = [];

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

      for (const t of response.data?.subtitles || []) {
        if (t.url) {
          subtitles.push({ url: t.url, label: t.lang || 'English', srclang: t.lang });
        }
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || 'Anify-Stream',
        sources,
        subtitles,
      };
    } catch {
      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || 'Anify-Stream',
        sources: [],
        subtitles: [],
      };
    }
  }
}

export const anifyProvider = new AnifyProvider();
