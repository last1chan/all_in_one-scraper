import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * 2DHive Provider (https://2dhive.com)
 * Everything.moe index:
 * - Library Size: 3,000+
 * - Server: Direct progressive MP4 video hosting
 */
export class Dhive2Provider extends BaseProvider {
  readonly name = '2dhive';
  readonly defaultBaseUrl = 'https://2dhive.com';
  readonly mirrorUrls = ['https://2dhive.com'];
  readonly languages = ['en'];
  readonly isSelfHosted = true;
  readonly librarySize = '3,000+';
  readonly serverType = 'self-hosted' as const;
  readonly notes = 'Direct progressive MP4 video streams';

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
    const url = `${baseUrl}/?s=${encodeURIComponent(query.trim())}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const $ = cheerio.load(response.data);
      const results: AnimeSearchResult[] = [];

      $('article, .post-item, a[href*="/anime/"]').each((_, el) => {
        const link = $(el).is('a') ? $(el) : $(el).find('a').first();
        const href = link.attr('href') || '';
        const match = href.match(/\/(?:anime|watch)\/([^/?#]+)/);
        if (!match) return;

        const id = match[1];
        const title = $(el).find('h2, h3, .title').text().trim() || link.text().trim();
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

      $('a[href*="-episode-"], .episodes-list a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/episode-(\d+)/) || href.match(/ep=(\d+)/);
        const epNum = match ? parseFloat(match[1]) : 1;

        if (!isNaN(epNum) && !episodes.some((e) => e.number === epNum)) {
          episodes.push({
            id: `${animeId}:${epNum}`,
            number: epNum,
            title: `Episode ${epNum}`,
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
    return [{ id: `${animeId}:${episodeNumber}:2dhive-mp4`, name: '2DHive-MP4 (Self-Hosted)', subType: 'sub' }];
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    serverId: string,
    subType: 'sub' | 'dub'
  ): Promise<StreamResolutionResult> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/anime/${animeId}-episode-${episodeNumber}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const sources: VideoSource[] = [];
      const $ = cheerio.load(response.data);

      $('video source, a[href*=".mp4"]').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('href');
        if (src && src.includes('.mp4')) {
          sources.push({
            url: src,
            type: 'mp4',
            quality: '1080p',
            isM3U8: false,
          });
        }
      });

      const mp4Matches = response.data.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/g);
      if (mp4Matches) {
        for (const m of mp4Matches) {
          if (!sources.some((s) => s.url === m)) {
            sources.push({ url: m, type: 'mp4', quality: '1080p', isM3U8: false });
          }
        }
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || '2DHive-MP4',
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
        server: serverId || '2DHive-MP4',
        sources: [],
        subtitles: [],
      };
    }
  }
}

export const dhive2Provider = new Dhive2Provider();
