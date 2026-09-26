import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class ZenkaiProvider extends BaseProvider {
  readonly name = 'zenkai';
  readonly defaultBaseUrl = 'https://zenkai.to';
  readonly mirrorUrls = ["https://zenkai.to","https://zenkai.in"];
  readonly languages = ['en'];
  readonly isSelfHosted = false;
  readonly librarySize = '4,000+';
  readonly serverType = 'third-party' as const;
  readonly notes = 'Anikoto reupload & proxy';

  constructor() {
    super();
    this.init();
  }

  private getHeaders(): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Referer': `${this.getBaseUrl()}/`,
    };
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<AnimeSearchResult[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/search?q=${encodeURIComponent(query.trim())}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const $ = cheerio.load(response.data);
      const results: AnimeSearchResult[] = [];

      $('.anime-card, .search-item, a[href*="/anime/"]').each((_, el) => {
        const link = $(el).is('a') ? $(el) : $(el).find('a').first();
        const href = link.attr('href') || '';
        const match = href.match(/\/anime\/([^/?#]+)/);
        if (!match) return;

        const id = match[1];
        const title = $(el).find('.title, h3, h2').text().trim() || link.text().trim();
        const poster = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');

        if (id && title && !results.some((r) => r.id === id)) {
          results.push({ id, title, poster, provider: this.name });
        }
      });

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
    const url = `${baseUrl}/anime/${animeId}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const $ = cheerio.load(response.data);
      const episodes: Episode[] = [];

      $('.ep-item, a[href*="/watch/"]').each((_, el) => {
        const epNumStr = $(el).attr('data-ep') || $(el).text().trim().match(/\d+/)?.[0] || '1';
        const epNum = parseFloat(epNumStr);
        const epId = $(el).attr('data-id') || `${animeId}-ep-${epNum}`;

        if (!isNaN(epNum) && !episodes.some((e) => e.number === epNum)) {
          episodes.push({
            id: epId,
            number: epNum,
            title: $(el).text().trim() || `Episode ${epNum}`,
            hasSub: true,
            hasDub: false,
          });
        }
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
      { id: `${animeId}:${episodeNumber}:zenkai-stream`, name: 'Zenkai Stream', subType: 'sub' },
      { id: `${animeId}:${episodeNumber}:anikoto-proxy`, name: 'Anikoto Reupload Server', subType: 'sub' },
    ];
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    serverId: string,
    subType: 'sub' | 'dub'
  ): Promise<StreamResolutionResult> {
    const baseUrl = this.getBaseUrl();
    const streamUrl = `${baseUrl}/stream/${animeId}-ep-${episodeNumber}.m3u8`;

    const sources: VideoSource[] = [
      {
        url: streamUrl,
        type: 'hls',
        quality: 'auto',
        isM3U8: true,
      },
    ];

    return {
      provider: this.name,
      animeId,
      episodeNumber,
      subType,
      server: serverId || 'Zenkai Stream',
      sources,
      subtitles: [],
    };
  }
}

export const zenkaiProvider = new ZenkaiProvider();
