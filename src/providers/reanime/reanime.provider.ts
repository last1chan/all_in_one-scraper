import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class ReAnimeProvider extends BaseProvider {
  readonly name = 'reanime';
  readonly defaultBaseUrl = 'https://reanime.to';
  readonly mirrorUrls = ['https://reanime.to'];
  readonly languages = ['en'];
  readonly isSelfHosted = true;
  readonly librarySize = '5,000+';
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
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    const cacheKey = this.getCacheKey('search', query);
    const cached = globalCache.get<AnimeSearchResult[]>(cacheKey);
    if (cached) return cached;

    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/search?keyword=${encodeURIComponent(query.trim())}`;

    try {
      const response = await axios.get<string>(url, { headers: this.getHeaders(), timeout: 10000 });
      const $ = cheerio.load(response.data);
      const results: AnimeSearchResult[] = [];

      $('.flw-item, .film_list-wrap .film-item, a[href*="/watch/"]').each((_, el) => {
        const link = $(el).is('a') ? $(el) : $(el).find('a').first();
        const href = link.attr('href') || '';
        const match = href.match(/\/(?:watch|anime)\/([^/?#]+)/);
        if (!match) return;

        const id = match[1];
        const title = $(el).find('.film-name, h3, .title').text().trim() || link.attr('title') || link.text().trim();
        const poster = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');

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

      $('.ep-item, a[data-number], a[href*="?ep="]').each((_, el) => {
        const epNumStr = $(el).attr('data-number') || $(el).text().trim().match(/\d+/)?.[0] || '1';
        const epNum = parseFloat(epNumStr);
        const epId = $(el).attr('data-id') || `${animeId}?ep=${epNum}`;

        if (!isNaN(epNum) && !episodes.some((e) => e.number === epNum)) {
          episodes.push({
            id: epId,
            number: epNum,
            title: $(el).attr('title') || `Episode ${epNum}`,
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
      { id: `${animeId}:${episodeNumber}:reanime-cdn`, name: 'ReAnime-CDN (Self-Hosted)', subType: 'sub' },
    ];
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
      const m3u8Match = response.data.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/g);

      if (m3u8Match) {
        for (const m3u8 of m3u8Match) {
          if (!sources.some((s) => s.url === m3u8)) {
            sources.push({ url: m3u8, type: 'hls', quality: 'auto', isM3U8: true });
          }
        }
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || 'ReAnime-CDN',
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
        server: serverId || 'ReAnime-CDN',
        sources: [],
        subtitles: [],
      };
    }
  }
}

export const reAnimeProvider = new ReAnimeProvider();
