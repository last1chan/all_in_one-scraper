import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class AniKuroProvider extends BaseProvider {
  readonly name = 'anikuro';
  readonly defaultBaseUrl = 'https://anikuro.ru';
  readonly mirrorUrls = ["https://anikuro.ru","https://anikuro.tv"];
  readonly languages = ['en'];
  readonly isSelfHosted = true;
  readonly librarySize = '3,600+';
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

      $('a[href*="/watch/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/\/watch\/([^/?#]+)/);
        if (!match) return;

        const id = match[1];
        const title = $(el).find('h3, .title, span').text().trim() || $(el).text().trim();
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
    const url = `${baseUrl}/watch/${animeId}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const $ = cheerio.load(response.data);
      const episodes: Episode[] = [];

      $('a[data-number], a[href*="?ep="]').each((_, el) => {
        const epNumStr = $(el).attr('data-number') || $(el).text().trim().match(/\d+/)?.[0] || '1';
        const epNum = parseFloat(epNumStr);

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
    return [{ id: `${animeId}:${episodeNumber}:kuro`, name: 'AniKuro-CDN (Self-Hosted)', subType: 'sub' }];
  }

  async getSources(
    animeId: string,
    episodeNumber: number,
    serverId: string,
    subType: 'sub' | 'dub'
  ): Promise<StreamResolutionResult> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/watch/${animeId}?ep=${episodeNumber}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const sources: VideoSource[] = [];
      const m3u8Match = response.data.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);

      if (m3u8Match) {
        sources.push({ url: m3u8Match[0], type: 'hls', quality: 'auto', isM3U8: true });
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || 'AniKuro-CDN',
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
        server: serverId || 'AniKuro-CDN',
        sources: [],
        subtitles: [],
      };
    }
  }
}

export const aniKuroProvider = new AniKuroProvider();
