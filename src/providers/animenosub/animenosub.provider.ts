import { BaseProvider } from '../base-provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult, VideoSource } from '../../types/anime.js';
import { globalCache } from '../../core/cache.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class AnimeNoSubProvider extends BaseProvider {
  readonly name = 'animenosub';
  readonly defaultBaseUrl = 'https://animenosub.to';
  readonly mirrorUrls = ["https://animenosub.to","https://animenosub.com"];
  readonly languages = ['ja', 'raw'];
  readonly isSelfHosted = true;
  readonly librarySize = '6,000+';
  readonly serverType = 'self-hosted' as const;
  readonly notes = 'Raw Japanese un-subbed audio & video releases';

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
        const match = href.match(/\/(?:anime|post)\/([^/?#]+)/);
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

      $('a[href*="-episode-"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/episode-(\d+)/);
        const epNum = match ? parseFloat(match[1]) : 1;

        if (!isNaN(epNum) && !episodes.some((e) => e.number === epNum)) {
          episodes.push({
            id: `${animeId}:${epNum}`,
            number: epNum,
            title: `Episode ${epNum} (RAW)`,
            hasSub: false,
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
    return [{ id: `${animeId}:${episodeNumber}:raw`, name: 'AnimeNoSub-RAW', subType: 'raw' }];
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
      const m3u8Match = response.data.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);

      if (m3u8Match) {
        sources.push({ url: m3u8Match[0], type: 'hls', quality: 'auto', isM3U8: true });
      }

      return {
        provider: this.name,
        animeId,
        episodeNumber,
        subType,
        server: serverId || 'AnimeNoSub-RAW',
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
        server: serverId || 'AnimeNoSub-RAW',
        sources: [],
        subtitles: [],
      };
    }
  }
}

export const animeNoSubProvider = new AnimeNoSubProvider();
