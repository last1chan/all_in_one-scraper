import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * WCO (WatchCartoonOnline) Provider (https://wcostream.tv / https://wcofun.net)
 * Everything.moe index:
 * - Library Size: 8,500+
 * - Server: Self-Hosted MP4 / Flash player
 * - Note: Some anime episodes are behind a subscriber paywall
 */
export class WcoProvider extends BaseProvider {
  readonly name = 'wco';
  readonly defaultBaseUrl = 'https://wcostream.tv';
  readonly mirrorUrls = ['https://wcostream.tv', 'https://wcofun.net', 'https://watchcartoononline.io'];
  readonly languages = ['en'];
  readonly isSelfHosted = true;
  readonly librarySize = '8,500+';
  readonly serverType = 'hybrid' as const;
  readonly notes = 'Some anime episodes are behind subscriber paywall';

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
    const url = `${baseUrl}/search`;

    try {
      const response = await axios.post<string>(
        url,
        `catara=${encodeURIComponent(query.trim())}&konu=!`,
        {
          headers: {
            ...this.getHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
        }
      );

      const $ = cheerio.load(response.data);
      const results: AnimeSearchResult[] = [];

      $('a[href*="/anime/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/\/anime\/([^/?#]+)/);
        if (!match) return;

        const id = match[1];
        const title = $(el).text().trim();
        const poster = $(el).find('img').attr('src');

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

      $('#sidebar_right a, .recent-release a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const title = $(el).text().trim();
        const match = title.match(/Episode\s+(\d+)/i) || href.match(/episode-(\d+)/i);
        const epNum = match ? parseFloat(match[1]) : 1;
        const epSlug = href.split('/').filter(Boolean).pop() || `${animeId}-episode-${epNum}`;

        if (!isNaN(epNum) && !episodes.some((e) => e.number === epNum)) {
          episodes.push({
            id: epSlug,
            number: epNum,
            title: title || `Episode ${epNum}`,
            hasSub: title.toLowerCase().includes('subbed'),
            hasDub: title.toLowerCase().includes('dubbed') || !title.toLowerCase().includes('subbed'),
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
    return [{ id: `${animeId}:${episodeNumber}:wco`, name: 'WCO-Player (Self-Hosted MP4)', subType: 'dub' }];
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    serverId: string,
    subType: 'sub' | 'dub'
  ): Promise<StreamResolutionResult> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/${animeId}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const sources: VideoSource[] = [];

      // Check for direct MP4 stream or iframe
      const mp4Matches = response.data.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/g);
      if (mp4Matches) {
        for (const m of mp4Matches) {
          if (!sources.some((s) => s.url === m)) {
            sources.push({ url: m, type: 'mp4', quality: '720p', isM3U8: false });
          }
        }
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || 'WCO-Player',
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
        server: serverId || 'WCO-Player',
        sources: [],
        subtitles: [],
      };
    }
  }
}

export const wcoProvider = new WcoProvider();
